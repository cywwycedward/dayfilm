import { app, BrowserWindow, dialog, ipcMain, powerMonitor, session, type IpcMainInvokeEvent } from 'electron'
import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IPC } from '../shared/ipc'
import type { Settings } from '../shared/settings'
import type { DayRollup, LiveState, Sample, Scene, ScreenplayExport } from '../shared/types'
import { loginItemSettings } from './autostart'
import { createCapture, resolveCaptureScript, type Capture } from './capture'
import { describeError } from './errors'
import { ensureExtension, ensureMarkdownPath } from './export'
import { createIngest, type IngestResult } from './ingest'
import { GUARDED_CHANNELS, createHandlers, parseDayRequest, type GuardedChannel, type GuardedHandler } from './ipc'
import { NotesStore } from './notes'
import { buildDayRollup, renderScreenplay, searchScenes } from './reel'
import { DayCache } from './reel/cache'
import { GAP_MS, IDLE_MS } from './reel/rules'
import { resolveResource } from './resources'
import { cleanupExpired } from './retention'
import { MAX_BASE64_LENGTH, decodePngBase64, sanitizeImageName } from './save-image'
import { isLocalRequest, isTrustedFrameUrl, isTrustedSenderInfo, type TrustedOrigin } from './security'
import { SettingsStore } from './settings'
import { DayStore, localDate } from './store'
import { WriteBuffer } from './store/buffer'
import { createTray, type TrayHandle } from './tray'
import type { TrayState } from './tray/tooltip'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
/** 检索最多回看最近 7 天。 */
const SEARCH_DAYS = 7
const TICK_MS = 2000
const DAY_MS = 86_400_000
/** 单日文件超过这个体积就提示（规格 R14.3）。 */
const DAY_FILE_LIMIT_BYTES = 64 * 1024 * 1024
/** 每这么多条采样检查一次文件体积（约 5 分钟）。 */
const SIZE_CHECK_APPENDS = 150
/** 自身进程名：开发时是 electron，打包后是 dayfilm（与采集脚本的 ProcessName 同源）。 */
const SELF_EXE = basename(process.execPath, '.exe')

let settings: SettingsStore
let notes: NotesStore
let store: DayStore
let cache: DayCache
let writeBuffer: WriteBuffer | null = null
let capture: Capture | null = null
let tray: TrayHandle | null = null
let mainWindow: BrowserWindow | null = null
let tickTimer: NodeJS.Timeout | null = null
let isQuitting = false
let status = { capturing: false, error: null as string | null }
let writeError: string | null = null
let sizeWarning: string | null = null
let retentionError: string | null = null
let appendCount = 0
/** 托盘建不起来时必须让窗口可见，否则 --hidden 会留下无窗口无托盘的进程。 */
let forceShowWindow = false
let ingest: ((raw: Sample) => IngestResult) | null = null

function todayKey(): string {
  return localDate(Date.now())
}

function storageError(): string | null {
  return writeError ?? retentionError ?? sizeWarning
}

function isPaused(): boolean {
  return settings.get().paused
}

/** 保留期内的日期（规格 R11.3）：即使清理失败，也不把过期日期给界面。 */
function keptDays(): string[] {
  const days = store.listDays()
  const retention = settings.get().retentionDays
  if (retention <= 0) return days
  const cutoff = localDate(Date.now() - retention * DAY_MS)
  return days.filter((date) => date >= cutoff)
}

function rollupFor(date: string): DayRollup {
  return cache.rollup(date, Date.now())
}

/** 正在拍摄的镜头：取尾部同窗口的非空闲采样，不必等到满 3 秒成镜。 */
function liveScene(samples: Sample[], day: DayRollup, date: string, now: number): Scene | null {
  const last = samples[samples.length - 1]
  if (!last || last.idleMs >= IDLE_MS) return null
  let start = last.t
  for (let index = samples.length - 2; index >= 0; index -= 1) {
    const sample = samples[index]
    if (sample.idleMs >= IDLE_MS || sample.exe !== last.exe || sample.title !== last.title) break
    if (last.t - sample.t > GAP_MS) break
    start = sample.t
  }
  // 与切分结果对齐时复用它的 id，界面才能高亮到胶片上的同一块。
  const match = day.scenes.find(
    (scene) => scene.kind === 'shot' && scene.start === start && scene.exe === last.exe && scene.title === last.title
  )
  const end = Math.max(now, last.t)
  return {
    id: match ? match.id : `${date}-live`,
    start,
    end,
    exe: last.exe,
    title: last.title,
    seconds: Math.round((end - start) / 1000),
    kind: 'shot'
  }
}

function liveState(): LiveState {
  const date = todayKey()
  const now = Date.now()
  const samples = cache.samples(date)
  const day = cache.rollup(date, now)
  return {
    capturing: status.capturing,
    captureError: status.error,
    storageError: storageError(),
    paused: isPaused(),
    now,
    scene: liveScene(samples, day, date, now),
    day
  }
}

function trayStateOf(state: LiveState): TrayState {
  return {
    paused: state.paused,
    captureError: state.captureError,
    storageError: state.storageError,
    activeMs: state.day.activeMs
  }
}

function broadcast(): void {
  const state = liveState()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.tick, state)
  }
  tray?.setState(trayStateOf(state))
}

async function exportScreenplay(date: string): Promise<ScreenplayExport> {
  // 契约：非法日期返回空路径，由界面提示，不抛错。
  if (!DATE_PATTERN.test(date)) return { path: '' }
  const options = {
    defaultPath: `dayfilm-${date}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  }
  const focused = BrowserWindow.getFocusedWindow()
  const result = focused ? await dialog.showSaveDialog(focused, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { path: '' }
  // 用户手输 x.txt 也要落成 x.md（R15.3 固定扩展名）。
  const target = ensureMarkdownPath(result.filePath)
  try {
    // 手记与项目规则参与导出（规格 R23.4 / R26.1）
    const text = renderScreenplay(rollupFor(date), { note: notes.get(date), projects: settings.get().projects })
    await writeFile(target, text, 'utf8')
  } catch (error) {
    throw new Error(`剧本保存失败：${describeError(error)}`)
  }
  return { path: target }
}

/** 海报/图片保存：界面把渲好的 PNG 交过来，主进程只负责校验、选路径、落盘。 */
async function saveImage(defaultName: unknown, pngBase64: unknown): Promise<{ path: string }> {
  if (typeof pngBase64 !== 'string' || pngBase64.length > MAX_BASE64_LENGTH) return { path: '' }
  const bytes = decodePngBase64(pngBase64)
  if (!bytes) return { path: '' }
  const options = {
    defaultPath: sanitizeImageName(defaultName),
    filters: [{ name: 'PNG', extensions: ['png'] }]
  }
  const focused = BrowserWindow.getFocusedWindow()
  const result = focused ? await dialog.showSaveDialog(focused, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { path: '' }
  const target = ensureExtension(result.filePath, 'png')
  try {
    await writeFile(target, bytes)
  } catch (error) {
    throw new Error(`海报保存失败：${describeError(error)}`)
  }
  return { path: target }
}

function rendererFileUrl(): string {
  return pathToFileURL(join(__dirname, '../renderer/index.html')).href
}

/** 打包版一律忽略 devserver 环境变量，外部注入的源不能成为可信来源（R15.2）。 */
function devServerUrl(): string | undefined {
  return app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
}

function trustedOrigin(): TrustedOrigin {
  return { devUrl: devServerUrl(), rendererFileUrl: rendererFileUrl() }
}

/** 只接受本应用窗口、本应用页面发起的调用（规格 R15.2）。 */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  let frameUrl = ''
  try {
    frameUrl = event.senderFrame?.url ?? ''
  } catch {
    return false
  }
  return isTrustedSenderInfo(
    { frameUrl, hasWindow: Boolean(BrowserWindow.fromWebContents(event.sender)) },
    trustedOrigin()
  )
}

function handleIpc(channel: GuardedChannel, handler: GuardedHandler): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event)) {
      // 只记通道名，不记参数：参数里可能有窗口标题。
      console.warn(`[dayfilm] 拒绝不可信来源的 IPC：${channel}`)
      throw new Error('调用来源不可信')
    }
    return handler(...args)
  })
}

function registerIpc(): void {
  const handlers = createHandlers({
    getDay: (date) => {
      const request = parseDayRequest(date)
      if (request.kind === 'today') return rollupFor(todayKey())
      // 非法日期回填请求的日期，而不是写成今天
      if (request.kind === 'invalid') return buildDayRollup([], request.date, Date.now())
      return rollupFor(request.date)
    },
    listDays: () => keptDays(),
    live: () => liveState(),
    search: (query) => {
      if (typeof query !== 'string') return []
      const dates = new Set<string>([todayKey(), ...keptDays()])
      const recent = [...dates].sort().reverse().slice(0, SEARCH_DAYS)
      return searchScenes(query, recent.map(rollupFor))
    },
    exportScreenplay: (date) => (typeof date === 'string' ? exportScreenplay(date) : { path: '' }),
    getSettings: () => settings.get(),
    setSettings: (patch) => applySettings(patch),
    getNote: (date) => (typeof date === 'string' && DATE_PATTERN.test(date) ? notes.get(date) : ''),
    setNote: (date, text) => {
      if (typeof date !== 'string' || !DATE_PATTERN.test(date) || typeof text !== 'string') return ''
      return notes.set(date, text)
    },
    saveImage: (defaultName, pngBase64) => saveImage(defaultName, pngBase64),
    quit: () => {
      quitApp()
    }
  })
  // 通道清单是单一来源：新增通道却漏给守卫，tests/main/ipc.test.ts 会失败。
  for (const channel of Object.values(GUARDED_CHANNELS)) handleIpc(channel, handlers[channel])
}

/** 应用设置变更的副作用：暂停/继续采集、同步启动项、立即清理过期数据。 */
function applySettings(patch: unknown): Settings {
  const before = settings.get()
  const next = settings.update(patch)
  if (next.paused !== before.paused) {
    if (next.paused) stopCapture()
    else startCapture()
  }
  if (next.autoStart !== before.autoStart) applyAutoStart(next.autoStart)
  if (next.retentionDays !== before.retentionDays) runRetention()
  broadcast()
  return next
}

function applyAutoStart(openAtLogin: boolean): void {
  try {
    // portable 目标下 process.execPath 是 %TEMP% 副本，真正的 exe 在 PORTABLE_EXECUTABLE_FILE
    app.setLoginItemSettings(loginItemSettings(openAtLogin, process.env, process.execPath))
  } catch (error) {
    console.warn('[dayfilm] 写入开机自启失败', describeError(error))
  }
}

function runRetention(): void {
  const result = cleanupExpired(store, settings.get().retentionDays, Date.now())
  for (const date of result.removed) cache.invalidate(date)
  retentionError =
    result.errors.length > 0
      ? `清理过期数据失败（${result.errors[0].message}），${result.errors.length} 个日文件未能删除`
      : null
}

function checkDayFileSize(date: string): void {
  const bytes = store.sizeOf(date)
  sizeWarning =
    bytes > DAY_FILE_LIMIT_BYTES
      ? `今日数据已超过 64 MB（约 ${Math.round(bytes / (1024 * 1024))} MB），建议导出剧本后清理`
      : null
}

function onSample(raw: Sample): void {
  ingest?.(raw)
}

function startCapture(): void {
  if (capture) return
  capture = createCapture({
    script: resolveCaptureScript({
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath
    }),
    onSample,
    onStatus(next) {
      status = next
    }
  })
  capture.start()
}

function stopCapture(): void {
  const current = capture
  capture = null
  current?.stop()
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#08090c',
    title: 'Dayfilm',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow = win

  win.once('ready-to-show', () => {
    if (!startedHidden() || forceShowWindow) win.show()
  })

  // 除应用自身页面外一律不允许导航、不开新窗口（规格 R15.2）。
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedFrameUrl(url, trustedOrigin())) event.preventDefault()
  })

  // 关窗只收进托盘；真正退出走托盘"退出"或界面 quit 通道（规格 R12.1）。
  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    win.hide()
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  const devUrl = devServerUrl()
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function startedHidden(): boolean {
  return process.argv.includes('--hidden')
}

function quitApp(): void {
  isQuitting = true
  app.quit()
}

function installNetworkGuard(): void {
  // 回环 http(s)/ws(s) 只给开发模式的 vite HMR 用，打包后一律取消（R15.5）。
  const allowLoopback = devServerUrl() !== undefined
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isLocalRequest(details.url, { allowLoopback }) })
  })
}

function setupTray(): void {
  try {
    tray = createTray({
      iconPath: resolveResource('tray.png', {
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath
      }),
      state: trayStateOf(liveState()),
      actions: {
        open: () => showWindow(),
        togglePause: () => {
          applySettings({ paused: !isPaused() })
        },
        quit: () => quitApp()
      }
    })
  } catch (error) {
    tray = null
    console.warn('[dayfilm] 托盘创建失败', describeError(error))
    // 没有托盘又没有窗口，用户只能去任务管理器里杀进程。
    if (startedHidden()) {
      forceShowWindow = true
      showWindow()
    }
  }
}

function setupPowerMonitor(): void {
  powerMonitor.on('suspend', () => {
    stopCapture()
  })
  powerMonitor.on('resume', () => {
    if (!isPaused()) startCapture()
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  app.whenReady().then(() => {
    const root = app.getPath('userData')
    settings = new SettingsStore(root)
    notes = new NotesStore(root)
    store = new DayStore(root)
    cache = new DayCache({
      load: (date) => store.readDay(date),
      keep: SELF_EXE.length > 0 ? (sample) => sample.exe !== SELF_EXE : undefined
    })
    const buffer = new WriteBuffer({
      write: (sample) => store.append(sample),
      onError: (message) => {
        writeError = message
      }
    })
    writeBuffer = buffer
    buffer.start()

    ingest = createIngest({
      cache,
      settings,
      buffer,
      onClockDrop: (count) => {
        // 只报计数，不进日志正文（R15.4）
        if (count === 1 || count % 50 === 0) {
          console.warn(`[dayfilm] 已丢弃 ${count} 条倒序采样（系统时钟回拨）`)
        }
      },
      onAccepted: (date) => {
        appendCount += 1
        if (appendCount % SIZE_CHECK_APPENDS === 0) checkDayFileSize(date)
      }
    })

    installNetworkGuard()
    applyAutoStart(settings.get().autoStart)
    runRetention()
    checkDayFileSize(todayKey())

    createWindow()
    if (!isPaused()) startCapture()
    registerIpc()
    setupTray()
    setupPowerMonitor()
    tickTimer = setInterval(broadcast, TICK_MS)

    app.on('activate', () => showWindow())
  })

  app.on('before-quit', () => {
    isQuitting = true
    if (tickTimer) {
      clearInterval(tickTimer)
      tickTimer = null
    }
    // 先停采集，再冲刷缓冲，避免收尾期间还有新采样进缓冲。
    stopCapture()
    ingest = null
    writeBuffer?.stop()
    writeBuffer?.drain()
    writeBuffer = null
    tray?.destroy()
    tray = null
  })

  app.on('window-all-closed', () => {
    // 常驻托盘：关窗只隐藏。托盘没建起来时退回"关完就退"，避免留下看不见的进程。
    if (!tray && process.platform !== 'darwin') app.quit()
  })
}
