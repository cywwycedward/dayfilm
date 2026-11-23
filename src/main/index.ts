import { app, BrowserWindow, dialog, globalShortcut, ipcMain, powerMonitor, session } from 'electron'
import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IPC } from '../shared/ipc'
import type { Settings } from '../shared/settings'
import type { DayRollup, LiveState, Sample, Scene, ScreenplayExport } from '../shared/types'
import { loginItemSettings } from './autostart'
import { createCapture, resolveCaptureScript, type Capture } from './capture'
import { parseEdlDate, writeEdlFile } from './edl'
import { describeError, describeWriteError } from './errors'
import { ensureExtension, ensureMarkdownPath } from './export'
import { createHud, hudPagePath, type HudHandle } from './hud'
import { createIngest, type IngestResult } from './ingest'
import {
  GUARDED_CHANNELS,
  MAXIMIZED_CHANGED_CHANNEL,
  PROJECTION_TOGGLE_CHANNEL,
  SEND_CHANNELS,
  WINDOW_CHANNELS,
  createHandlers,
  createSendHandlers,
  createWindowHandlers,
  parseDayRequest,
  type GuardedChannel,
  type GuardedHandler,
  type SendChannel,
  type WindowChannel
} from './ipc'
import { MarksStore } from './marks'
import { NotesStore } from './notes'
import { buildScriptHtml } from './pdf'
import { writePdf } from './pdf/render'
import { buildDayRollup, renderScreenplay, searchScenes } from './reel'
import { DayCache } from './reel/cache'
import { GAP_MS, IDLE_MS } from './reel/rules'
import { resolveResource } from './resources'
import { cleanupExpired } from './retention'
import { MAX_BASE64_LENGTH, decodePngBase64, sanitizeImageName } from './save-image'
import { isLocalRequest, isTrustedFrameUrl, isTrustedSenderInfo, type TrustedOrigin } from './security'
import { SettingsStore } from './settings'
import { registerShortcuts, type ShortcutResult } from './shortcuts'
import { DayStore, localDate } from './store'
import { WriteBuffer } from './store/buffer'
import { createTray, type TrayHandle } from './tray'
import { bindMaximizeEvents, createWindowActions } from './window-chrome'
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
let marks: MarksStore
let store: DayStore
let cache: DayCache
let writeBuffer: WriteBuffer | null = null
let capture: Capture | null = null
let hud: HudHandle | null = null
let shortcuts: ShortcutResult | null = null
let shortcutWarning: string | null = null
let tray: TrayHandle | null = null
let mainWindow: BrowserWindow | null = null
let tickTimer: NodeJS.Timeout | null = null
let isQuitting = false
let status = { capturing: false, error: null as string | null }

/** 无边框窗口的三个按钮：目标是主窗口；窗口不存在（例如退出中）时静默忽略。 */
const windowActions = createWindowActions(() => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null))
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
    hudVisible: settings.get().hud.visible,
    shortcutWarning,
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
    throw new Error(`剧本保存失败：${describeWriteError(error)}`)
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
    throw new Error(`海报保存失败：${describeWriteError(error)}`)
  }
  return { path: target }
}

/** EDL 导出（规格 R42）：日期校验 → 对话框 → 固定 .edl 扩展名 → 写盘。 */
async function exportEdl(rawDate: unknown): Promise<{ path: string }> {
  const date = parseEdlDate(rawDate)
  if (!date) return { path: '' }
  const options = {
    defaultPath: `dayfilm-${date}.edl`,
    filters: [{ name: 'CMX3600 EDL', extensions: ['edl'] }]
  }
  const focused = BrowserWindow.getFocusedWindow()
  const result = focused ? await dialog.showSaveDialog(focused, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { path: '' }
  const target = ensureExtension(result.filePath, 'edl')
  // 写盘失败抛可读错误；IPC 层会把 rejection 交给界面提示（不静默）
  await writeEdlFile(target, rollupFor(date))
  return { path: target }
}

/** 剧本 PDF 导出（规格 R53）：日期校验 → 对话框 → 固定 .pdf 扩展名 → 隐藏窗口打印 → 写盘。 */
async function exportPdf(rawDate: unknown): Promise<{ path: string }> {
  const date = parseEdlDate(rawDate)
  if (!date) return { path: '' }
  const options = {
    defaultPath: `dayfilm-${date}.pdf`,
    filters: [{ name: 'PDF 文档', extensions: ['pdf'] }]
  }
  const focused = BrowserWindow.getFocusedWindow()
  const result = focused ? await dialog.showSaveDialog(focused, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { path: '' }
  const target = ensureExtension(result.filePath, 'pdf')
  const html = buildScriptHtml(rollupFor(date), { note: notes.get(date), projects: settings.get().projects })
  await writePdf(html, target)
  return { path: target }
}

/**
 * 标记某天的一个镜头（花絮/正片/清除），返回重算后的当日汇总。
 * 标记变了就把该日从缓存剔除再重算，避免任何一处拿到旧快照。
 */
function setMarkAndRollup(date: unknown, startMs: unknown, mark: unknown): DayRollup {
  if (typeof date !== 'string' || !DATE_PATTERN.test(date)) throw new Error('标记日期不合法')
  if (typeof startMs !== 'number' || !Number.isFinite(startMs)) throw new Error('标记的镜头时刻不合法')
  if (mark !== null && mark !== 'feature' && mark !== 'extra') throw new Error('标记类型不合法')
  marks.set(date, startMs, mark)
  cache.invalidate(date)
  return rollupFor(date)
}

/** 显示/隐藏导演 HUD：界面与托盘共用一个实现，设置落盘后立即生效。 */
function setHudVisible(visible: unknown): { visible: boolean } {
  const next = Boolean(visible)
  const current = settings.get().hud
  if (current.visible !== next) applySettings({ hud: { ...current, visible: next } })
  hud?.setVisible(next)
  return { visible: next }
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

/** 只接受本应用窗口、本应用页面发起的调用（规格 R15.2）。invoke 与 send 事件共用。 */
function isTrustedSender(event: { sender: Electron.WebContents; senderFrame: Electron.WebFrameMain | null }): boolean {
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

function handleIpc(channel: GuardedChannel | WindowChannel, handler: GuardedHandler): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event)) {
      // 只记通道名，不记参数：参数里可能有窗口标题。
      console.warn(`[dayfilm] 拒绝不可信来源的 IPC：${channel}`)
      throw new Error('调用来源不可信')
    }
    return handler(...args)
  })
}

/** 单向 send 通道（如 HUD 单击）同样过来源守卫，不合法直接丢弃。 */
function listenIpc(channel: SendChannel, handler: GuardedHandler): void {
  ipcMain.on(channel, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event)) {
      console.warn(`[dayfilm] 拒绝不可信来源的 IPC：${channel}`)
      return
    }
    handler(...args)
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
    exportEdl: (date) => exportEdl(date),
    exportPdf: (date) => exportPdf(date),
    setMark: (date, startMs, mark) => setMarkAndRollup(date, startMs, mark),
    setHud: (visible) => setHudVisible(visible),
    quit: () => {
      quitApp()
    }
  })
  // 通道清单是单一来源：新增通道却漏给守卫，tests/main/ipc.test.ts 会失败。
  for (const channel of Object.values(GUARDED_CHANNELS)) handleIpc(channel, handlers[channel])

  const sendHandlers = createSendHandlers({ hudOpen: () => showWindow() })
  for (const channel of Object.values(SEND_CHANNELS)) listenIpc(channel, sendHandlers[channel])

  // 无边框窗口的三个按钮：同样过来源守卫
  const windowHandlers = createWindowHandlers(windowActions)
  for (const channel of Object.values(WINDOW_CHANNELS)) handleIpc(channel, windowHandlers[channel])
}

/** 应用设置变更的副作用：暂停/继续采集、同步启动项、立即清理过期数据、HUD 显隐。 */
function applySettings(patch: unknown): Settings {
  const before = settings.get()
  const next = settings.update(patch)
  if (next.hud.visible !== before.hud.visible) hud?.setVisible(next.hud.visible)
  if (next.paused !== before.paused) {
    if (next.paused) stopCapture()
    else startCapture()
  }
  if (next.autoStart !== before.autoStart) applyAutoStart(next.autoStart)
  if (next.retentionDays !== before.retentionDays) runRetention()
  // 自动花絮阈值影响所有已加载日期的汇总：改了就把缓存全清，下次读取按新规则算
  if (next.autoExtraUnderSec !== before.autoExtraUnderSec) cache.invalidate()
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
    // 无边框：标题栏与窗口按钮由界面自绘（v2.1）。thickFrame 保证拖边缘仍能缩放，
    // roundedCorners 让 Win11 的圆角生效；背景色与界面一致，避免启动白闪。
    frame: false,
    thickFrame: true,
    roundedCorners: true,
    show: false,
    backgroundColor: '#0a0b0d',
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

  // 最大化状态变化 → 界面换按钮图标
  const unbindMaximize = bindMaximizeEvents(win, (maximized) => {
    if (!win.isDestroyed()) win.webContents.send(MAXIMIZED_CHANGED_CHANNEL, maximized)
  })

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
    unbindMaximize()
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
  const paths = {
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath
  }
  try {
    tray = createTray({
      icons: {
        active: resolveResource('tray.png', paths),
        paused: resolveResource('tray-paused.png', paths),
        error: resolveResource('tray-error.png', paths)
      },
      state: trayStateOf(liveState()),
      actions: {
        open: () => showWindow(),
        togglePause: () => {
          applySettings({ paused: !isPaused() })
        },
        toggleHud: () => {
          setHudVisible(!settings.get().hud.visible)
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

/** 导演 HUD：按设置创建并按需显示（规格 R40）。页面缺失时内部会告警一次并保持隐藏。 */
function setupHud(): void {
  hud = createHud({
    settings: () => settings.get().hud,
    savePosition: (x, y) => {
      const current = settings.get().hud
      try {
        applySettings({ hud: { ...current, x, y } })
      } catch (error) {
        // 位置写不进去不影响 HUD 使用，下次拖动再试
        console.warn('[dayfilm] HUD 位置保存失败', describeError(error))
      }
    },
    preload: join(__dirname, '../preload/index.js'),
    hudFile: hudPagePath(__dirname),
    devUrl: devServerUrl()
  })
  hud.setVisible(settings.get().hud.visible)
}

/**
 * 全局快捷键（规格 R54）：HUD 开关与放映切换。被占用时只记录 + 托盘提示一次，
 * 不重试、不阻塞启动。
 */
function setupShortcuts(): void {
  shortcuts = registerShortcuts(
    {
      register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
      unregisterAll: () => globalShortcut.unregisterAll()
    },
    {
      toggleHud: () => {
        setHudVisible(!settings.get().hud.visible)
      },
      toggleProjection: () => {
        showWindow()
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(PROJECTION_TOGGLE_CHANNEL)
        }
      }
    }
  )
  if (shortcuts.failures.length > 0) {
    shortcutWarning = '快捷键被占用'
    // 只记一次，不重试
    console.warn('[dayfilm] 全局快捷键注册失败', shortcuts.failures.join(', '))
  }
}

function setupPowerMonitor(): void {  powerMonitor.on('suspend', () => {
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
    marks = new MarksStore(root)
    store = new DayStore(root)
    cache = new DayCache({
      load: (date) => store.readDay(date),
      keep: SELF_EXE.length > 0 ? (sample) => sample.exe !== SELF_EXE : undefined,
      // 标记是读取时叠加的，变了不需要重建增量状态
      marks: (date) => marks.get(date),
      autoExtraUnderSec: () => settings.get().autoExtraUnderSec
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
    setupShortcuts()
    setupTray()
    setupHud()
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
    hud?.destroy()
    hud = null
    shortcuts?.unregisterAll()
    shortcuts = null
  })

  app.on('window-all-closed', () => {
    // 常驻托盘：关窗只隐藏。托盘没建起来时退回"关完就退"，避免留下看不见的进程。
    if (!tray && process.platform !== 'darwin') app.quit()
  })
}
