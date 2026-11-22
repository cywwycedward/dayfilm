/** 界面主体：构建骨架、维护状态、把状态写到 DOM。数据只来自 DayfilmSource。 */
import type { DayRollup, LiveState, Scene } from '../../shared/types'
import {
  BUILTIN_REDACT_TERMS,
  DEFAULT_SETTINGS,
  RETENTION_OPTIONS,
  type Settings
} from '../../shared/settings'
import { createSource, type DayfilmSource } from './data'
import { sceneAt } from './lib/reel'
import { pickHighlights } from './lib/highlights'
import { computePoster } from './lib/poster'
import { buildWeek, lastSevenDates, type WeekCell } from './lib/week'
import {
  buildWeekFilm,
  buildWeekVerdict,
  mondayOf,
  pickWeekHighlights,
  weekDates,
  weekRangeLabel,
  type ActModel,
  type StoryColumn,
  type WeekDay,
  type WeekEntry,
  type WeekFilm
} from './lib/week-film'
import { matchProject, totalByProject } from '../../shared/projects'
import {
  DAY_MS as DAY_MS_FROM_ZOOM,
  clampView,
  ensureVisible,
  fullDay,
  layoutInView,
  offsetInView,
  ticksInView,
  zoomAt,
  zoomLevel,
  type TimeView
} from './lib/zoom'
import {
  fmtClock,
  fmtDateLabel,
  fmtDuration,
  fmtElapsed,
  fmtMinutes,
  isoDate,
  startOfDay
} from './lib/time'
import { paintPoster, paintReel, paintWeekBars, sizeCanvas, stillDataUrl } from './paint'
import { followDate } from './lib/date-follow'
import { revealScrollTop, windowRange } from './lib/window'

const DAY_MS = DAY_MS_FROM_ZOOM
const SEARCH_LIMIT = 200
/** 虚拟列表上下各保留的缓冲行数 */
const OVERSCAN = 5
const FALLBACK_ROW_STRIDE = 44
const PANEL_STATUS_MS = 4000
const SPEEDS = [60, 600, 3600] as const
type Speed = (typeof SPEEDS)[number]

interface Anchor {
  wall: number
  now: number
}

interface State {
  source: DayfilmSource
  date: string
  dates: string[]
  day: DayRollup
  live: LiveState | null
  anchor: Anchor
  selectedId: string | null
  results: Scene[] | null
  playing: boolean
  speed: Speed
  playhead: number
  settings: Settings
  /** 设置是否已从主进程读回；未读回时面板显示加载中 */
  settingsReady: boolean
  panelOpen: boolean
  /** 用户主动选了历史日期；true 时跨零点不把视图拉回今天 */
  browsingHistory: boolean
  /** 已为哪一天补拉过日期列表，避免同一天反复刷新 */
  datesRefreshedFor: string | null
  /** 胶片视窗（缩放与平移） */
  view: TimeView
  /** 最近 7 天的日期与汇总，用于周视图 */
  weekDates: string[]
  weekDays: (DayRollup | null)[]
  /** 当前日期的导演手记 */
  note: string
  noteSaved: string
  /** day = 胶片视图，week = 一周电影 */
  mode: 'day' | 'week'
  /** 周模式当前显示的周的周一 */
  weekMonday: string
  /** 周模式的数据缓存：日期 → 当天汇总（null 表示读取失败/没有数据） */
  weekCache: Map<string, DayRollup | null>
  weekThisDays: WeekDay[]
  weekLastDays: WeekDay[]
  weekFilm: WeekFilm | null
  weekLoading: boolean
}

interface Ui {
  date: HTMLSelectElement
  search: HTMLInputElement
  exportBtn: HTMLButtonElement
  chip: HTMLElement
  chipText: HTMLElement
  banner: HTMLElement
  bannerText: HTMLElement
  notice: HTMLElement
  liveDot: HTMLElement
  liveText: HTMLElement
  elapsed: HTMLElement
  reelTitle: HTMLElement
  ruler: HTMLElement
  track: HTMLElement
  canvas: HTMLCanvasElement
  nowMark: HTMLElement
  playhead: HTMLElement
  tip: HTMLElement
  frameBox: HTMLElement
  frame: HTMLImageElement
  frameTag: HTMLElement
  frameTitle: HTMLElement
  frameSub: HTMLElement
  playBtn: HTMLButtonElement
  speedBtns: HTMLButtonElement[]
  scrub: HTMLInputElement
  timecode: HTMLElement
  genre: HTMLElement
  verdict: HTMLElement
  genreMeta: HTMLElement
  metrics: HTMLElement
  ranking: HTMLElement
  listTitle: HTMLElement
  listCount: HTMLElement
  listScroll: HTMLElement
  spacer: HTMLElement
  list: HTMLElement
  empty: HTMLElement
  announce: HTMLElement
  storageBanner: HTMLElement
  storageText: HTMLElement
  settingsBtn: HTMLButtonElement
  drawer: HTMLElement
  drawerScrim: HTMLElement
  panel: HTMLElement
  panelClose: HTMLButtonElement
  panelStatus: HTMLElement
  retention: HTMLSelectElement
  termChips: HTMLElement
  termForm: HTMLFormElement
  termInput: HTMLInputElement
  autoStart: HTMLInputElement
  pausedToggle: HTMLInputElement
  quitBtn: HTMLButtonElement
  builtinTerms: HTMLElement
  exportPosterBtn: HTMLButtonElement
  zoomIn: HTMLButtonElement
  zoomOut: HTMLButtonElement
  zoomReset: HTMLButtonElement
  zoomLevel: HTMLElement
  week: HTMLElement
  note: HTMLTextAreaElement
  noteCount: HTMLElement
  noteStatus: HTMLElement
  projectTotals: HTMLElement
  projectCards: HTMLElement
  projectForm: HTMLFormElement
  projectName: HTMLInputElement
  projectTerms: HTMLInputElement
  highlights: HTMLElement
  modeDay: HTMLButtonElement
  modeWeek: HTMLButtonElement
  weekFilm: HTMLElement
  weekRange: HTMLElement
  weekPrev: HTMLButtonElement
  weekNext: HTMLButtonElement
  weekToday: HTMLButtonElement
  weekArcs: HTMLElement
  storyline: HTMLElement
  weekVerdict: HTMLElement
  weekEvidence: HTMLElement
  weekEvidenceBody: HTMLElement
  weekPicks: HTMLElement
}

let state!: State
let ui!: Ui
let trackWidth = 0
let trackHeight = 0
let trackRect: DOMRect | null = null
let reelKey = ''
let frameKey = ''
let timecodeKey = ''
let raf = 0
let lastFrameTime = 0
let lastPlayheadX = -1
let lastNowX = -1
let searchTimer = 0
let noticeTimer = 0
let rowStride = FALLBACK_ROW_STRIDE
let listViewport = 0
let listSignature = ''
let windowSignature = ''
let scrollRaf = 0
let panelStatusTimer = 0
let noteTimer = 0
let drag: { x: number; startMs: number; moved: boolean } | null = null
let appRoot: HTMLElement | null = null

function dayStart(): number {
  return startOfDay(state.date)
}

function effectiveNow(): number {
  return state.anchor.now + (Date.now() - state.anchor.wall)
}

function isToday(): boolean {
  return state.date === isoDate(Date.now())
}

/** 回放的上界：今天到"现在"，历史日到最后一个镜头。 */
function dayEnd(): number {
  const start = dayStart()
  const floor = start + 60_000
  const ceiling = start + DAY_MS
  if (isToday()) return Math.min(ceiling, Math.max(floor, effectiveNow()))
  return Math.min(ceiling, Math.max(floor, state.day.lastAt ?? floor))
}

function initialPlayhead(): number {
  const start = dayStart()
  if (isToday()) return Math.min(start + DAY_MS, Math.max(start, effectiveNow()))
  return Math.min(start + DAY_MS, Math.max(start, state.day.lastAt ?? start))
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function collect(root: HTMLElement): Ui {
  const pick = <T extends Element>(id: string): T => {
    const found = root.querySelector<T>(`#${id}`)
    if (!found) throw new Error(`缺少界面元素 #${id}`)
    return found
  }
  return {
    date: pick<HTMLSelectElement>('date'),
    search: pick<HTMLInputElement>('search'),
    exportBtn: pick<HTMLButtonElement>('export'),
    chip: pick<HTMLElement>('chip'),
    chipText: pick<HTMLElement>('chipText'),
    banner: pick<HTMLElement>('banner'),
    bannerText: pick<HTMLElement>('bannerText'),
    notice: pick<HTMLElement>('notice'),
    liveDot: pick<HTMLElement>('liveDot'),
    liveText: pick<HTMLElement>('liveText'),
    elapsed: pick<HTMLElement>('elapsed'),
    reelTitle: pick<HTMLElement>('reelTitle'),
    ruler: pick<HTMLElement>('ruler'),
    track: pick<HTMLElement>('track'),
    canvas: pick<HTMLCanvasElement>('reelCanvas'),
    nowMark: pick<HTMLElement>('nowMark'),
    playhead: pick<HTMLElement>('playhead'),
    tip: pick<HTMLElement>('tip'),
    frameBox: pick<HTMLElement>('frameBox'),
    frame: pick<HTMLImageElement>('frame'),
    frameTag: pick<HTMLElement>('frameTag'),
    frameTitle: pick<HTMLElement>('frameTitle'),
    frameSub: pick<HTMLElement>('frameSub'),
    playBtn: pick<HTMLButtonElement>('play'),
    speedBtns: [...root.querySelectorAll<HTMLButtonElement>('.speed')],
    scrub: pick<HTMLInputElement>('scrub'),
    timecode: pick<HTMLElement>('timecode'),
    genre: pick<HTMLElement>('genre'),
    verdict: pick<HTMLElement>('verdict'),
    genreMeta: pick<HTMLElement>('genreMeta'),
    metrics: pick<HTMLElement>('metrics'),
    ranking: pick<HTMLElement>('ranking'),
    listTitle: pick<HTMLElement>('listTitle'),
    listCount: pick<HTMLElement>('listCount'),
    listScroll: pick<HTMLElement>('listScroll'),
    spacer: pick<HTMLElement>('listSpacer'),
    list: pick<HTMLElement>('list'),
    empty: pick<HTMLElement>('empty'),
    announce: pick<HTMLElement>('announce'),
    storageBanner: pick<HTMLElement>('storageBanner'),
    storageText: pick<HTMLElement>('storageText'),
    settingsBtn: pick<HTMLButtonElement>('settings'),
    drawer: pick<HTMLElement>('drawer'),
    drawerScrim: pick<HTMLElement>('drawerScrim'),
    panel: pick<HTMLElement>('panel'),
    panelClose: pick<HTMLButtonElement>('panelClose'),
    panelStatus: pick<HTMLElement>('panelStatus'),
    retention: pick<HTMLSelectElement>('settingRetention'),
    termChips: pick<HTMLElement>('termChips'),
    termForm: pick<HTMLFormElement>('termForm'),
    termInput: pick<HTMLInputElement>('termInput'),
    autoStart: pick<HTMLInputElement>('settingAutoStart'),
    pausedToggle: pick<HTMLInputElement>('settingPaused'),
    quitBtn: pick<HTMLButtonElement>('quitBtn'),
    builtinTerms: pick<HTMLElement>('builtinTerms'),
    exportPosterBtn: pick<HTMLButtonElement>('exportPoster'),
    zoomIn: pick<HTMLButtonElement>('zoomIn'),
    zoomOut: pick<HTMLButtonElement>('zoomOut'),
    zoomReset: pick<HTMLButtonElement>('zoomReset'),
    zoomLevel: pick<HTMLElement>('zoomLevel'),
    week: pick<HTMLElement>('week'),
    note: pick<HTMLTextAreaElement>('note'),
    noteCount: pick<HTMLElement>('noteCount'),
    noteStatus: pick<HTMLElement>('noteStatus'),
    projectTotals: pick<HTMLElement>('projectTotals'),
    projectCards: pick<HTMLElement>('projectCards'),
    projectForm: pick<HTMLFormElement>('projectForm'),
    projectName: pick<HTMLInputElement>('projectName'),
    projectTerms: pick<HTMLInputElement>('projectTerms'),
    highlights: pick<HTMLElement>('highlights'),
    modeDay: pick<HTMLButtonElement>('modeDay'),
    modeWeek: pick<HTMLButtonElement>('modeWeek'),
    weekFilm: pick<HTMLElement>('weekFilm'),
    weekRange: pick<HTMLElement>('weekRange'),
    weekPrev: pick<HTMLButtonElement>('weekPrev'),
    weekNext: pick<HTMLButtonElement>('weekNext'),
    weekToday: pick<HTMLButtonElement>('weekToday'),
    weekArcs: pick<HTMLElement>('weekArcs'),
    storyline: pick<HTMLElement>('storyline'),
    weekVerdict: pick<HTMLElement>('weekVerdict'),
    weekEvidence: pick<HTMLElement>('weekEvidence'),
    weekEvidenceBody: pick<HTMLElement>('weekEvidenceBody'),
    weekPicks: pick<HTMLElement>('weekPicks')
  }
}

function renderRuler(): void {
  if (trackWidth <= 0) {
    ui.ruler.replaceChildren()
    return
  }
  const ticks = ticksInView(state.view)
  const width = trackWidth
  const dayEnd = dayStart() + DAY_MS
  ui.ruler.replaceChildren(
    ...ticks.map((ts) => {
      const x = offsetInView(ts, state.view, width)
      // 一天最后一个刻度写成 24:00，而不是下一天的 00:00
      const tick = node('span', 'ruler__tick', ts === dayEnd ? '24:00' : fmtClock(ts))
      tick.style.left = `${Math.min(width, Math.max(0, x))}px`
      let align = 'mid'
      if (x < 24) align = 'start'
      else if (x > width - 24) align = 'end'
      tick.dataset.align = align
      return tick
    })
  )
}

function renderDates(): void {
  const today = isoDate(Date.now())
  // 今天可能还没有日文件：即使主进程没返回今天，也要让下拉框里有它
  const dates = state.dates.includes(state.date) ? state.dates : [state.date, ...state.dates]
  ui.date.replaceChildren(
    ...dates.map((date) => {
      const option = node('option', undefined, fmtDateLabel(date, today))
      option.value = date
      return option
    })
  )
  ui.date.value = state.date
}

/** 重新拉一次日期列表（跨零点、保留期变更后）。失败时保留旧列表。 */
async function refreshDates(): Promise<void> {
  try {
    state.dates = await state.source.listDays()
    renderDates()
  } catch {
    // 日期列表刷新失败不影响胶片展示，下一次 tick 还会再试
  }
}

function renderLive(): void {
  const live = state.live
  const captureError = live?.captureError ?? null
  const storageError = live?.storageError ?? null
  // 用户主动暂停，或子进程没在跑又没报错，都当“已暂停”
  const paused = live !== null && (live.paused || (!live.capturing && captureError === null))
  const scene = live?.scene ?? null

  ui.liveDot.dataset.state = paused ? 'paused' : scene ? 'shooting' : 'idle'
  if (paused) {
    ui.liveText.textContent = '已暂停'
  } else if (scene) {
    const exe = node('strong', undefined, scene.exe)
    ui.liveText.replaceChildren(
      document.createTextNode('正在拍摄：'),
      exe,
      document.createTextNode(` · ${scene.title}`)
    )
  } else {
    ui.liveText.textContent = '空闲中'
  }

  ui.banner.hidden = captureError === null
  ui.bannerText.textContent = captureError ?? ''
  ui.storageBanner.hidden = storageError === null
  ui.storageText.textContent = storageError ?? ''

  // 采集错误优先于暂停：出错时 chip 必须是红的
  let status: 'ok' | 'paused' | 'error' = 'ok'
  if (captureError !== null) status = 'error'
  else if (paused) status = 'paused'
  ui.chip.dataset.state = status
  if (status === 'error') ui.chipText.textContent = '采集中断'
  else if (status === 'paused') ui.chipText.textContent = '已暂停'
  else ui.chipText.textContent = '采集正常'
  updateElapsed()
}

function updateElapsed(): void {
  const live = state.live
  // 暂停时不给“已持续”继续跳：用最后一帧 tick 的时间
  const now = live?.paused === true ? live.now : effectiveNow()
  const scene = live?.scene ?? null
  const since = scene ? scene.start : (live?.day.lastAt ?? now)
  ui.elapsed.textContent = fmtElapsed(Math.max(0, now - since))
}

function measure(): void {
  const width = ui.track.clientWidth
  const height = ui.track.clientHeight
  const viewport = ui.listScroll.clientHeight
  const stride = readRowStride()
  trackRect = null
  lastPlayheadX = -1
  lastNowX = -1
  if (width !== trackWidth || height !== trackHeight) {
    trackWidth = width
    trackHeight = height
    renderReel()
    renderRuler()
    updateMarkers()
  }
  if (viewport !== listViewport || stride !== rowStride) {
    listViewport = viewport
    rowStride = stride
    windowSignature = ''
    renderWindow()
  }
}

/** 行高由 CSS 变量 --row-stride 定义，只在尺寸变化时读一次。 */
function readRowStride(): number {
  const raw = getComputedStyle(ui.listScroll).getPropertyValue('--row-stride')
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) && value > 0 ? value : FALLBACK_ROW_STRIDE
}

function renderReel(): void {
  if (trackWidth <= 0 || trackHeight <= 0) return
  const view = state.view
  const xOf = (ts: number): number => Math.min(trackWidth, Math.max(0, offsetInView(ts, view, trackWidth)))
  const first = state.day.firstAt
  const last = state.day.lastAt
  const materialStartX = first === null ? trackWidth : xOf(first)
  const materialEndX = last === null ? 0 : xOf(last)
  const nowX = state.day.scenes.length > 0 && isToday() ? xOf(effectiveNow()) : -1
  // 只在胶片真变了才重画：空闲时 tick 不带新镜头，不重绘
  const key = `${state.selectedId}|${state.day.scenes.length}|${first}|${last}|${Math.round(nowX)}|${Math.round(view.startMs)}|${Math.round(view.spanMs)}|${trackWidth}x${trackHeight}`
  if (key === reelKey) return
  reelKey = key
  const ctx = sizeCanvas(ui.canvas, trackWidth, trackHeight)
  if (!ctx) return
  paintReel(ctx, layoutInView(state.day.scenes, view, trackWidth), trackWidth, trackHeight, {
    selectedId: state.selectedId,
    materialStartX,
    materialEndX,
    nowX
  })
}

/** 只写 transform，不读布局；回放时每帧只动这两个指针。视窗外的指针直接隐藏。 */
function updateMarkers(): void {
  if (trackWidth <= 0) return
  const view = state.view
  const playheadX = offsetInView(state.playhead, view, trackWidth)
  const playheadVisible = playheadX >= 0 && playheadX <= trackWidth
  const today = isToday()
  const nowX = offsetInView(effectiveNow(), view, trackWidth)
  const nowVisible = today && nowX >= 0 && nowX <= trackWidth
  if (ui.nowMark.hidden !== !nowVisible) ui.nowMark.hidden = !nowVisible
  if (nowVisible && Math.abs(nowX - lastNowX) > 0.5) {
    lastNowX = nowX
    ui.nowMark.style.transform = `translate3d(${nowX}px,0,0)`
    ui.nowMark.dataset.side = nowX > trackWidth - 60 ? 'left' : 'right'
  }
  const hidePlayhead = !playheadVisible || (nowVisible && !state.playing && Math.abs(playheadX - nowX) < 1.5)
  if (ui.playhead.hidden !== hidePlayhead) ui.playhead.hidden = hidePlayhead
  if (playheadVisible && Math.abs(playheadX - lastPlayheadX) > 0.25) {
    lastPlayheadX = playheadX
    ui.playhead.style.transform = `translate3d(${playheadX}px,0,0)`
  }
}

function renderSummary(): void {
  const day = state.day
  const hasData = day.scenes.length > 0
  const shots = day.scenes.filter((scene) => scene.kind === 'shot')
  ui.genre.textContent = hasData ? day.verdict.label : '未开镜'
  if (hasData) ui.verdict.textContent = day.verdict.note
  else if (isToday()) ui.verdict.textContent = '还没有拍摄任何素材，今天这卷胶片是空的。'
  else ui.verdict.textContent = '这一天没有采样，胶片是空的。'
  ui.genreMeta.textContent = hasData
    ? `题材 · 每小时 ${day.verdict.cutRate.toFixed(1)} 次剪辑`
    : '题材 · 等待第一个镜头'

  const metrics: [string, string][] = [
    ['活跃时长', fmtMinutes(day.activeMs)],
    ['空闲时长', fmtMinutes(day.idleMs)],
    ['镜头', `${shots.length}`],
    ['剪辑', `${day.cuts}`],
    ['最长镜头', day.longestShot ? fmtDuration(day.longestShot.seconds) : '—']
  ]
  ui.metrics.replaceChildren(
    ...metrics.map(([label, value]) => {
      const cell = node('div', 'metric')
      cell.append(node('dt', 'metric__label', label), node('dd', 'metric__value', value))
      return cell
    })
  )

  const peak = day.topApps.reduce((max, app) => Math.max(max, app.seconds), 0)
  ui.ranking.replaceChildren(
    ...(day.topApps.length > 0
      ? day.topApps.map((app) => {
          const row = node('div', 'rank')
          const bar = node('span', 'rank__bar')
          const fill = node('i')
          fill.style.width = `${peak > 0 ? (app.seconds / peak) * 100 : 0}%`
          bar.append(fill)
          row.append(
            node('span', 'rank__name', app.exe),
            bar,
            node('span', 'rank__value', fmtMinutes(app.seconds * 1000))
          )
          return row
        })
      : [node('p', 'rank rank--empty', '还没有进程时长')])
  )

  renderProjectTotals(day)
}

/** 汇总面板的项目分区：没有规则时给一句引导，有规则时按命中时长倒序前 5。 */
function renderProjectTotals(day: DayRollup): void {
  const rules = state.settings.projects
  if (rules.length === 0) {
    ui.projectTotals.replaceChildren(
      node('p', 'rank rank--empty', '在设置里加一条项目规则，把镜头归到故事线上')
    )
    return
  }
  const totals = totalByProject(day.scenes, rules).slice(0, 5)
  if (totals.length === 0) {
    ui.projectTotals.replaceChildren(node('p', 'rank rank--empty', '今天没有镜头命中项目规则'))
    return
  }
  const peak = totals[0].ms
  ui.projectTotals.replaceChildren(
    ...totals.map((item) => {
      const row = node('div', 'rank')
      const bar = node('span', 'rank__bar')
      const fill = node('i')
      fill.style.width = `${peak > 0 ? (item.ms / peak) * 100 : 0}%`
      bar.append(fill)
      row.append(
        node('span', 'rank__name', item.name),
        bar,
        node('span', 'rank__value', fmtMinutes(item.ms))
      )
      return row
    })
  )
}

function buildRow(scene: Scene, withDate: boolean, index: number, total: number): HTMLLIElement {
  const item = node('li', 'shot-row')
  item.setAttribute('aria-setsize', String(total))
  item.setAttribute('aria-posinset', String(index + 1))
  const button = node('button', scene.kind === 'intermission' ? 'shot shot--inter' : 'shot')
  button.type = 'button'
  button.dataset.id = scene.id

  const thumb = node('span', 'shot__thumb')
  if (scene.kind === 'shot') {
    const img = node('img')
    img.src = stillDataUrl(scene.exe, scene.title)
    img.alt = ''
    img.loading = 'lazy'
    thumb.append(img)
  }

  const stamp = withDate ? `${isoDate(scene.start).slice(5)} ` : ''
  const title = scene.kind === 'intermission' ? '离开键盘' : scene.title || '—'
  const titleCell = node('span', 'shot__title')
  const project = scene.kind === 'shot' ? matchProject(scene, state.settings.projects) : null
  if (project) titleCell.append(node('span', 'shot__project', project))
  titleCell.append(node('span', 'shot__title-text', title))
  button.append(
    thumb,
    node('span', 'shot__clock', `${stamp}${fmtClock(scene.start)}–${fmtClock(scene.end)}`),
    node('span', 'shot__exe', scene.kind === 'intermission' ? '中场休息' : scene.exe),
    titleCell,
    node('span', 'shot__dur', fmtDuration(scene.seconds))
  )
  button.addEventListener('click', () => {
    void locate(scene)
  })
  item.append(button)
  return item
}

/** 列表当前展示的数据：检索结果或当天胶片。 */
function visibleScenes(): readonly Scene[] {
  return state.results ?? state.day.scenes
}

function renderList(): void {
  const searching = state.results !== null
  const scenes = visibleScenes()
  const shots = scenes.filter((scene) => scene.kind === 'shot').length
  const rests = scenes.length - shots
  ui.listTitle.textContent = searching ? '检索结果' : '镜头列表'
  if (searching) {
    ui.listCount.textContent = `${scenes.length} 条${scenes.length >= SEARCH_LIMIT ? '（上限 200）' : ''}`
  } else {
    ui.listCount.textContent = rests > 0 ? `${rests} 段中场休息 · ${shots} 个镜头` : `${shots} 个镜头`
  }

  const last = scenes[scenes.length - 1]
  // 数据签名变短了：窗口化后只关心首尾与长度，末尾镜头的时长仍会跟着 tick 更新
  const signature = `${searching ? 'q' : 'd'}|${scenes.length}|${scenes[0]?.id ?? ''}|${last?.id ?? ''}|${last?.end ?? 0}`
  if (signature !== listSignature) {
    listSignature = signature
    windowSignature = ''
  }

  ui.empty.hidden = scenes.length > 0
  ui.empty.textContent = searching ? '没有匹配的镜头' : emptyCopy()
  renderWindow()
}

/** 只把可视区加缓冲内的行渲染出来；其余行由 spacer 高度占位。 */
function renderWindow(): void {
  const scenes = visibleScenes()
  const range = windowRange({
    count: scenes.length,
    rowHeight: rowStride,
    scrollTop: ui.listScroll.scrollTop,
    viewportHeight: listViewport,
    overscan: OVERSCAN
  })
  ui.spacer.style.height = `${range.totalHeight}px`
  ui.list.style.transform = `translate3d(0,${range.offset}px,0)`
  const signature = `${listSignature}|${range.start}|${range.end}`
  if (signature === windowSignature) return
  windowSignature = signature

  const today = isoDate(Date.now())
  const withDate = state.results !== null
  const rows: HTMLLIElement[] = []
  for (let index = range.start; index < range.end; index += 1) {
    const scene = scenes[index]
    rows.push(buildRow(scene, withDate && isoDate(scene.start) !== today, index, scenes.length))
  }
  ui.list.replaceChildren(...rows)
  highlight()
}

/** 把某一行滚进视野（虚拟列表下不能依赖 scrollIntoView）。 */
function revealRow(id: string, align: 'center' | 'nearest'): HTMLElement | null {
  const scenes = visibleScenes()
  const index = scenes.findIndex((scene) => scene.id === id)
  if (index < 0) return null
  const viewport = listViewport > 0 ? listViewport : ui.listScroll.clientHeight
  const target = revealScrollTop({
    index,
    rowHeight: rowStride,
    viewportHeight: viewport,
    scrollTop: ui.listScroll.scrollTop,
    align
  })
  if (Math.abs(ui.listScroll.scrollTop - target) >= 1) ui.listScroll.scrollTop = target
  windowSignature = ''
  renderWindow()
  return ui.list.querySelector<HTMLElement>(`[data-id="${id}"]`)
}

function highlight(): void {
  for (const button of ui.list.querySelectorAll<HTMLElement>('.shot')) {
    const active = button.dataset.id === state.selectedId
    button.classList.toggle('is-active', active)
    if (active) button.setAttribute('aria-current', 'true')
    else button.removeAttribute('aria-current')
  }
}

function updateTransport(): void {
  const scene = sceneAt(state.playhead, state.day.scenes)
  if (scene) {
    if (scene.id !== frameKey) {
      frameKey = scene.id
      const intermission = scene.kind === 'intermission'
      ui.frameBox.dataset.kind = intermission ? 'intermission' : 'shot'
      ui.frameTag.hidden = !intermission
      if (intermission) ui.frame.removeAttribute('src')
      else ui.frame.src = stillDataUrl(scene.exe, scene.title)
      ui.frameTitle.textContent = intermission ? '中场休息' : scene.title
      ui.frameSub.textContent = intermission
        ? `${fmtClock(scene.start)}–${fmtClock(scene.end)} · ${fmtDuration(scene.seconds)}`
        : `${scene.exe} · ${fmtClock(scene.start)}–${fmtClock(scene.end)} · ${fmtDuration(scene.seconds)}`
    }
  } else {
    // 指针落在没有镜头的时段：既不冒充上一个镜头，也不冒充空白的一天
    const next = state.day.scenes.find((item) => item.start > state.playhead) ?? null
    const key = `gap:${next?.id ?? 'end'}:${state.day.scenes.length}`
    if (key !== frameKey) {
      frameKey = key
      ui.frameBox.dataset.kind = 'empty'
      ui.frameTag.hidden = true
      ui.frame.removeAttribute('src')
      if (state.day.scenes.length === 0) {
        ui.frameTitle.textContent = emptyCopy()
        ui.frameSub.textContent = isToday() ? '胶片是空的' : '这一天没有记录'
      } else {
        ui.frameTitle.textContent = '空档'
        ui.frameSub.textContent = next
          ? `没有采样 · 下一个镜头 ${fmtClock(next.start)}`
          : '这一天的胶片到此结束'
      }
    }
  }

  const minutes = String(Math.round((state.playhead - dayStart()) / 60_000))
  if (ui.scrub.value !== minutes) ui.scrub.value = minutes
  const code = `${fmtClock(state.playhead)} / 24:00`
  if (code !== timecodeKey) {
    timecodeKey = code
    ui.timecode.textContent = code
  }
}

function renderDay(): void {
  ui.reelTitle.textContent = isToday() ? '今日胶片' : '当日胶片'
  renderReel()
  renderSummary()
  renderHighlights()
  renderList()
  highlight()
  updateMarkers()
  updateTransport()
}

function announce(message: string): void {
  ui.announce.textContent = message
}

function toast(message: string): void {
  ui.notice.textContent = message
  ui.notice.dataset.open = 'true'
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    ui.notice.dataset.open = 'false'
  }, 6000)
}

function pause(): void {
  state.playing = false
  ui.playBtn.textContent = '播放'
  ui.playBtn.dataset.state = 'paused'
  cancelAnimationFrame(raf)
}

function step(now: number): void {
  if (!state.playing) return
  const delta = Math.min(200, Math.max(0, now - lastFrameTime))
  lastFrameTime = now
  state.playhead = Math.min(dayEnd(), state.playhead + delta * state.speed)
  updateMarkers()
  updateTransport()
  if (state.playhead >= dayEnd()) {
    pause()
    return
  }
  raf = requestAnimationFrame(step)
}

function togglePlay(): void {
  if (state.playing) {
    pause()
    return
  }
  if (state.day.scenes.length === 0) return
  // 停在“现在”时没有可播的前方，按回放的意思从 00:00 重新放起
  if (dayEnd() - state.playhead < 60_000) {
    state.playhead = dayStart()
    announce('从 00:00 开始回放')
  }
  state.playing = true
  ui.playBtn.textContent = '暂停'
  ui.playBtn.dataset.state = 'playing'
  lastFrameTime = performance.now()
  raf = requestAnimationFrame(step)
}

function seek(ts: number): void {
  state.playhead = Math.min(dayEnd(), Math.max(dayStart(), ts))
  if (state.playing) lastFrameTime = performance.now()
  updateMarkers()
  updateTransport()
}

function announceScene(prefix: string, scene: Scene): void {
  const who = scene.kind === 'intermission' ? '中场休息' : `${scene.exe}，${scene.title}`
  announce(`${prefix}：${fmtClock(scene.start)}–${fmtClock(scene.end)}，${who}，${fmtDuration(scene.seconds)}`)
}

function selectScene(scene: Scene): void {
  state.selectedId = scene.id
  pause()
  state.playhead = Math.min(dayEnd(), Math.max(dayStart(), scene.start))
  // 选中镜头一定要在视窗里，缩放后也一样
  state.view = ensureVisible(state.view, scene.start, scene.end, dayStart())
  lastPlayheadX = -1
  lastNowX = -1
  renderReel()
  renderRuler()
  updateZoomLevel()
  highlight()
  updateMarkers()
  updateTransport()
  announceScene('已选镜头', scene)
}

function openDetail(scene: Scene): void {
  const row = revealRow(scene.id, 'center')
  row?.focus({ preventScroll: true })
  announceScene('镜头详情', scene)
}

async function locate(scene: Scene): Promise<void> {
  const date = isoDate(scene.start)
  if (date !== state.date) await loadDate(date)
  const target = state.day.scenes.find((item) => item.id === scene.id)
  if (target) selectScene(target)
  revealRow(scene.id, 'nearest')
}

/** 换日期或换检索结果时回到列表顶部，否则会停在上一份数据的位置。 */
function resetListScroll(): void {
  ui.listScroll.scrollTop = 0
  listSignature = ''
  windowSignature = ''
}

async function loadDate(date: string): Promise<void> {
  state.date = date
  // 主动翻到非今天 = 浏览历史，跨零点也不再拉回视图
  state.browsingHistory = date !== isoDate(Date.now())
  // 下拉框的选项里永远包含当前日期：没有日文件的天也能选中并显示
  renderDates()
  state.day = await state.source.getDay(date)
  state.selectedId = null
  pause()
  state.view = fullDay(startOfDay(date))
  state.playhead = initialPlayhead()
  resetListScroll()
  frameKey = ''
  timecodeKey = ''
  reelKey = ''
  // 手记先清空再载入，不能把上一天的内容留在框里
  window.clearTimeout(noteTimer)
  state.note = ''
  state.noteSaved = ''
  ui.note.value = ''
  updateNoteMeta()
  setNoteStatus('idle', '')
  renderDay()
  renderRuler()
  updateZoomLevel()
  void loadNote(date)
  renderWeek()
}

/** 空状态的文案：今天还没素材和历史某天没采样是两件事。 */
function emptyCopy(): string {
  return isToday() ? '还没有拍摄任何素材' : '这一天没有采样'
}

function hideTip(): void {
  ui.tip.hidden = true
}

function timeAtClientX(clientX: number): number {
  const rect = trackRect ?? ui.track.getBoundingClientRect()
  trackRect = rect
  if (rect.width <= 0) return state.view.startMs
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  return state.view.startMs + ratio * state.view.spanMs
}

function applyView(next: TimeView): void {
  state.view = clampView(next, dayStart())
  lastPlayheadX = -1
  lastNowX = -1
  renderReel()
  renderRuler()
  updateMarkers()
  updateZoomLevel()
}

function zoomBy(factor: number, anchorMs?: number): void {
  const anchor = anchorMs ?? state.view.startMs + state.view.spanMs / 2
  applyView(zoomAt(state.view, factor, anchor, dayStart()))
}

function updateZoomLevel(): void {
  const level = zoomLevel(state.view)
  ui.zoomLevel.textContent = `${level < 1.05 ? 1 : Math.round(level)}x`
  ui.zoomOut.disabled = state.view.spanMs >= DAY_MS
  ui.zoomIn.disabled = state.view.spanMs <= 30 * 60_000
  ui.zoomReset.disabled = state.view.spanMs >= DAY_MS
}

function onWheel(event: WheelEvent): void {
  event.preventDefault()
  // 每次重读几何：窗口变窄或出现滚动条后缓存的矩形会偏，锚点会漂
  const rect = ui.track.getBoundingClientRect()
  trackRect = rect
  if (rect.width <= 0) return
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  const anchor = state.view.startMs + ratio * state.view.spanMs
  const factor = Math.exp(-event.deltaY * 0.0016)
  zoomBy(factor, anchor)
  hideTip()
}

function onHover(event: PointerEvent): void {
  if (drag?.moved) {
    hideTip()
    return
  }
  const rect = trackRect ?? ui.track.getBoundingClientRect()
  trackRect = rect
  if (rect.width <= 0) return
  const scene = sceneAt(timeAtClientX(event.clientX), state.day.scenes)
  if (!scene) {
    hideTip()
    return
  }
  const offsetX = Math.min(160, rect.width / 2)
  const offset = Math.min(rect.width - offsetX, Math.max(offsetX, event.clientX - rect.left))
  ui.tip.style.transform = `translate3d(${offset}px,0,0)`
  ui.tip.replaceChildren(
    node('span', 'tip__title', scene.kind === 'intermission' ? '中场休息' : scene.title),
    node(
      'span',
      'tip__meta',
      `${fmtClock(scene.start)}–${fmtClock(scene.end)} · ${fmtDuration(scene.seconds)}`
    )
  )
  ui.tip.hidden = false
}

function onTrackPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  trackRect = ui.track.getBoundingClientRect()
  drag = { x: event.clientX, startMs: state.view.startMs, moved: false }
  ui.track.setPointerCapture(event.pointerId)
}

function onTrackPointerMove(event: PointerEvent): void {
  if (!drag) return
  const dx = event.clientX - drag.x
  if (!drag.moved && Math.abs(dx) <= 3) return
  drag.moved = true
  ui.track.dataset.dragging = 'true'
  const width = trackWidth > 0 ? trackWidth : 1
  applyView({ startMs: drag.startMs - (dx / width) * state.view.spanMs, spanMs: state.view.spanMs })
}

function onTrackPointerUp(event: PointerEvent): void {
  if (!drag) return
  const moved = drag.moved
  drag = null
  delete ui.track.dataset.dragging
  if (ui.track.hasPointerCapture(event.pointerId)) ui.track.releasePointerCapture(event.pointerId)
  if (moved) return
  const time = timeAtClientX(event.clientX)
  const scene = sceneAt(time, state.day.scenes)
  if (scene) selectScene(scene)
  else {
    pause()
    seek(time)
  }
}

function onTrackKey(event: KeyboardEvent): void {
  const scenes = state.day.scenes
  if (scenes.length === 0) return
  const index = scenes.findIndex((scene) => scene.id === state.selectedId)
  switch (event.key) {
    case 'ArrowRight':
      event.preventDefault()
      selectScene(scenes[index < 0 ? 0 : Math.min(scenes.length - 1, index + 1)])
      return
    case 'ArrowLeft':
      event.preventDefault()
      selectScene(scenes[index < 0 ? scenes.length - 1 : Math.max(0, index - 1)])
      return
    case 'Home':
      event.preventDefault()
      selectScene(scenes[0])
      return
    case 'End':
      event.preventDefault()
      selectScene(scenes[scenes.length - 1])
      return
    case 'Enter':
      if (index >= 0) {
        event.preventDefault()
        openDetail(scenes[index])
      }
      return
    case ' ':
      event.preventDefault()
      togglePlay()
      return
    default:
  }
}

function setSpeed(speed: Speed): void {
  state.speed = speed
  for (const button of ui.speedBtns) {
    const active = Number(button.dataset.speed) === speed
    button.classList.toggle('is-active', active)
    button.setAttribute('aria-pressed', String(active))
  }
}

async function exportDay(): Promise<void> {
  ui.exportBtn.disabled = true
  try {
    const path = await state.source.exportScreenplay(state.date)
    toast(`剧本已导出：${path}`)
  } catch (error) {
    toast(`导出失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    ui.exportBtn.disabled = false
  }
}

async function runSearch(): Promise<void> {
  const query = ui.search.value.trim()
  if (query.length === 0) {
    state.results = null
    resetListScroll()
    renderList()
    highlight()
    return
  }
  const hits = await state.source.search(query)
  if (query !== ui.search.value.trim()) return
  state.results = hits.slice(0, SEARCH_LIMIT)
  resetListScroll()
  renderList()
  highlight()
}

function scheduleSearch(): void {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    void runSearch()
  }, 160)
}

function handleTick(live: LiveState): void {
  state.live = live
  state.anchor = { wall: Date.now(), now: live.now }
  renderLive()

  const follow = followDate({
    current: state.date,
    today: isoDate(Date.now()),
    browsingHistory: state.browsingHistory,
    liveDate: live.day.date,
    knownDates: state.dates,
    refreshedFor: state.datesRefreshedFor
  })

  if (follow.refreshDates) {
    state.datesRefreshedFor = live.day.date
    void refreshDates()
  }

  if (follow.nextDate !== null) {
    // 跨零点：跟着主进程换到新的一天（用户没在翻历史才会走到这里）
    void loadDate(follow.nextDate)
    return
  }

  if (live.day.date === state.date) {
    state.day = live.day
    renderDay()
  } else {
    updateMarkers()
  }
  renderWeek()
  if (state.mode === 'week') refreshWeekFilm()
  void syncSettingsFromHost()
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 外部（托盘或另一条 IPC）修改了设置：轮询到差异后重算主视图。 */
let settingsPolling = false
let lastSettingsPoll = 0
const SETTINGS_POLL_MS = 3000

async function syncSettingsFromHost(): Promise<void> {
  if (settingsPolling || !state.settingsReady) return
  const now = Date.now()
  if (now - lastSettingsPoll < SETTINGS_POLL_MS) return
  lastSettingsPoll = now
  settingsPolling = true
  try {
    const next = await state.source.getSettings()
    if (JSON.stringify(next) !== JSON.stringify(state.settings)) applyExternalSettings(next)
  } catch {
    // 读设置失败不影响主视图，下次 tick 再试
  } finally {
    settingsPolling = false
  }
}

function applyExternalSettings(next: Settings): void {
  state.settings = next
  renderSettings()
  renderSummary()
  // 项目标签依赖规则，列表要整份重算
  listSignature = ''
  windowSignature = ''
  renderList()
  refreshWeekIfVisible()
}

function setPanelStatus(text: string, kind: 'idle' | 'ok' | 'error'): void {
  ui.panelStatus.textContent = text
  ui.panelStatus.dataset.kind = kind
  window.clearTimeout(panelStatusTimer)
  if (kind === 'ok') {
    panelStatusTimer = window.setTimeout(() => {
      ui.panelStatus.textContent = ''
      ui.panelStatus.dataset.kind = 'idle'
    }, PANEL_STATUS_MS)
  }
}

/** 保留期选项与内置脱敏词都是合同里给的常量，这里只渲染一次。 */
function renderSettingsStatic(): void {
  ui.retention.replaceChildren(
    ...RETENTION_OPTIONS.map((option) => {
      const item = node('option', undefined, option.label)
      item.value = String(option.value)
      return item
    })
  )
  ui.builtinTerms.textContent = BUILTIN_REDACT_TERMS.join(' · ')
}

function renderSettings(): void {
  const settings = state.settings
  ui.retention.value = String(settings.retentionDays)
  ui.autoStart.checked = settings.autoStart
  ui.pausedToggle.checked = settings.paused
  const chips: HTMLElement[] = settings.redactTerms.map((term) => {
    const chip = node('span', 'term')
    chip.append(node('span', 'term__label', term))
    const remove = node('button', 'term__remove', '×')
    remove.type = 'button'
    remove.dataset.term = term
    remove.setAttribute('aria-label', `删除关键词 ${term}`)
    chip.append(remove)
    return chip
  })
  if (chips.length === 0) chips.push(node('span', 'term term--empty', '还没有自定义关键词'))
  ui.termChips.replaceChildren(...chips)
  renderProjectCards()
}

async function loadSettings(): Promise<void> {
  if (state.settingsReady) return
  setPanelStatus('正在读取设置…', 'idle')
  try {
    state.settings = await state.source.getSettings()
    state.settingsReady = true
    renderSettings()
    // 项目规则影响汇总与列表标签，读回来就要重算
    renderSummary()
    listSignature = ''
    windowSignature = ''
    renderList()
    refreshWeekIfVisible()
    setPanelStatus('', 'idle')
  } catch (error) {
    setPanelStatus(`读取设置失败：${messageOf(error)}`, 'error')
  }
}

/** 提交设置。失败时回到提交前的值并报错，不假装保存成功。 */
async function applySettings(patch: Partial<Settings>): Promise<boolean> {
  const before = state.settings
  try {
    const next = await state.source.setSettings(patch)
    state.settings = next
    state.settingsReady = true
    renderSettings()
    setPanelStatus('已保存', 'ok')
    // 暂停开关要立即反映到实时条，不等下一轮 tick
    if (patch.paused !== undefined && state.live !== null) {
      state.live = { ...state.live, paused: next.paused }
      renderLive()
    }
    // R11.3：保留期变了就重拉日期列表，已删掉的日期不能留在下拉框里
    if (patch.retentionDays !== undefined) {
      state.datesRefreshedFor = null
      void refreshDates()
    }
    // 项目规则变了：汇总与列表标签都要重算
    if (patch.projects !== undefined) {
      listSignature = ''
      windowSignature = ''
      renderSummary()
      renderList()
      refreshWeekIfVisible()
    }
    return true
  } catch (error) {
    state.settings = before
    renderSettings()
    setPanelStatus(`保存失败：${messageOf(error)}`, 'error')
    return false
  }
}

function panelFocusables(): HTMLElement[] {
  const selector =
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  return [...ui.panel.querySelectorAll<HTMLElement>(selector)].filter((element) => element.offsetParent !== null)
}

function openPanel(): void {
  if (state.panelOpen) return
  state.panelOpen = true
  ui.drawer.hidden = false
  ui.settingsBtn.setAttribute('aria-expanded', 'true')
  renderSettings()
  ui.retention.focus()
  void loadSettings()
}

function closePanel(): void {
  if (!state.panelOpen) return
  state.panelOpen = false
  ui.drawer.hidden = true
  ui.settingsBtn.setAttribute('aria-expanded', 'false')
  setPanelStatus('', 'idle')
  // 触发按钮只有一个：关闭后把焦点固定还给它
  ui.settingsBtn.focus({ preventScroll: true })
}

/** Esc 关闭；Tab 在面板内循环，不跑到背后的界面上。 */
function onPanelKey(event: KeyboardEvent): void {
  if (!state.panelOpen) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closePanel()
    return
  }
  if (event.key !== 'Tab') return
  const items = panelFocusables()
  if (items.length === 0) {
    event.preventDefault()
    return
  }
  const active = document.activeElement
  const index = active instanceof HTMLElement ? items.indexOf(active) : -1
  const first = items[0]
  const last = items[items.length - 1]
  if (event.shiftKey && index <= 0) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (index < 0 || index === items.length - 1)) {
    event.preventDefault()
    first.focus()
  }
}

async function quitApp(): Promise<void> {
  ui.quitBtn.disabled = true
  try {
    await state.source.quit()
    if (state.source.mode === 'mock') setPanelStatus('演示环境不会真的退出', 'ok')
  } catch (error) {
    setPanelStatus(`退出失败：${messageOf(error)}`, 'error')
  } finally {
    ui.quitBtn.disabled = false
  }
}

async function addTerm(): Promise<void> {
  const term = ui.termInput.value.trim()
  if (term.length === 0) return
  if (state.settings.redactTerms.includes(term)) {
    setPanelStatus('这个关键词已经在列表里', 'error')
    return
  }
  const saved = await applySettings({ redactTerms: [...state.settings.redactTerms, term] })
  if (saved) ui.termInput.value = ''
}

function removeTerm(term: string): void {
  void applySettings({ redactTerms: state.settings.redactTerms.filter((item) => item !== term) })
}

/** 滚动只在下一帧重算可见区间，不在滚动事件里同步读写布局。 */
function onListScroll(): void {
  if (scrollRaf !== 0) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    renderWindow()
  })
}

/* 周视图 ------------------------------------------------------------- */

let weekSignature = ''

/** 周视图：最近 7 天的 24 桶迷你条；今天优先用实时数据。 */
function renderWeek(): void {
  if (state.weekDates.length === 0) {
    ui.week.replaceChildren()
    return
  }
  const today = isoDate(Date.now())
  const days = [...state.weekDays]
  if (state.live !== null) {
    const index = state.weekDates.indexOf(today)
    if (index >= 0) days[index] = state.live.day
  }
  const cells = buildWeek(state.weekDates, days, today)
  const signature = `${cells.map((cell) => `${cell.date}:${cell.isToday ? 1 : 0}`).join('|')}|${state.date}`
  if (signature !== weekSignature) {
    weekSignature = signature
    ui.week.replaceChildren(...cells.map((cell) => weekCellNode(cell)))
  }
  paintWeek(cells)
}

function weekCellNode(cell: WeekCell): HTMLElement {
  const button = node('button', 'week__day')
  button.type = 'button'
  button.dataset.date = cell.date
  button.classList.toggle('is-active', cell.date === state.date)
  button.classList.toggle('is-selected', cell.date === state.date)
  button.classList.toggle('is-today', cell.isToday)
  button.setAttribute('aria-pressed', String(cell.date === state.date))
  if (cell.date === state.date) button.setAttribute('aria-current', 'date')
  const label = fmtDateLabel(cell.date, isoDate(Date.now())).replace('今天 · ', '')
  button.setAttribute('aria-label', `${label}${cell.hasData ? '，有记录' : '，无记录'}`)
  const canvas = node('canvas', 'week__bars')
  canvas.width = 192
  canvas.height = 44
  button.append(canvas, node('span', 'week__label', label))
  return button
}

function paintWeek(cells: WeekCell[]): void {
  const canvases = ui.week.querySelectorAll<HTMLCanvasElement>('canvas.week__bars')
  cells.forEach((cell, index) => {
    const canvas = canvases[index]
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    paintWeekBars(ctx, cell.buckets, canvas.width, canvas.height)
  })
}

async function loadStripWeek(): Promise<void> {
  const today = isoDate(Date.now())
  const dates = lastSevenDates(today)
  const known = new Set(state.dates)
  state.weekDates = dates
  state.weekDays = await Promise.all(
    dates.map((date) => {
      if (date === today && state.live !== null) return Promise.resolve(state.live.day)
      if (!known.has(date)) return Promise.resolve(null)
      return state.source.getDay(date).catch(() => null)
    })
  )
  weekSignature = ''
  renderWeek()
}

/** 换到某一天：退出检索、回到列表顶部、重置视窗。 */
async function selectDay(date: string): Promise<void> {
  ui.search.value = ''
  state.results = null
  resetListScroll()
  await loadDate(date)
}

/* 导演手记 ----------------------------------------------------------- */

function updateNoteMeta(): void {
  const length = ui.note.value.length
  ui.noteCount.textContent = `${length}/200`
}

function setNoteStatus(kind: 'idle' | 'saving' | 'saved' | 'error', text: string): void {
  ui.noteStatus.dataset.kind = kind
  ui.noteStatus.textContent = text
}

async function loadNote(date: string): Promise<void> {
  try {
    const text = await state.source.getNote(date)
    if (state.date !== date) return
    state.note = text
    state.noteSaved = text
    ui.note.value = text
    updateNoteMeta()
    setNoteStatus('idle', '')
  } catch (error) {
    setNoteStatus('error', `手记读取失败：${messageOf(error)}`)
  }
}

function onNoteInput(): void {
  state.note = ui.note.value.slice(0, 200)
  updateNoteMeta()
  setNoteStatus('idle', '')
  window.clearTimeout(noteTimer)
  noteTimer = window.setTimeout(() => {
    void saveNote()
  }, 600)
}

/** 停止输入 600ms 后自动保存；失败时保留编辑内容并报错。 */
async function saveNote(): Promise<void> {
  const date = state.date
  const text = state.note
  if (text === state.noteSaved) return
  setNoteStatus('saving', '保存中…')
  try {
    const saved = await state.source.setNote(date, text)
    if (state.date !== date) return
    state.noteSaved = saved
    state.note = saved
    if (ui.note.value !== saved) ui.note.value = saved
    updateNoteMeta()
    setNoteStatus('saved', '已保存')
  } catch (error) {
    setNoteStatus('error', `保存失败：${messageOf(error)}`)
  }
}

/* 高光 --------------------------------------------------------------- */

function renderHighlights(): void {
  const hasShots = state.day.scenes.some((scene) => scene.kind === 'shot')
  const highlights = hasShots ? pickHighlights(state.day) : null
  const cards: HTMLElement[] = []
  const longest = highlights?.longest ?? null
  if (longest) {
    const card = node('button', 'highlight highlight--action')
    card.type = 'button'
    card.append(
      node('span', 'highlight__label', '最长镜头'),
      node('span', 'highlight__value', fmtDuration(longest.seconds)),
      node('span', 'highlight__sub', `${longest.exe || '中场休息'} · ${fmtClock(longest.start)}–${fmtClock(longest.end)}`)
    )
    card.addEventListener('click', () => {
      selectScene(longest)
      revealRow(longest.id, 'center')
    })
    cards.push(card)
  }
  const busiest = highlights?.busiest ?? null
  if (busiest) {
    const card = node('div', 'highlight')
    card.append(
      node('span', 'highlight__label', '最密 30 分钟'),
      node('span', 'highlight__value', `${busiest.cuts} 次剪辑`),
      node('span', 'highlight__sub', `${fmtClock(busiest.start)}–${fmtClock(busiest.end)}`)
    )
    cards.push(card)
  }
  const topApp = highlights?.topApp ?? null
  if (topApp) {
    const card = node('div', 'highlight')
    card.append(
      node('span', 'highlight__label', '时长第一的进程'),
      node('span', 'highlight__value', fmtMinutes(topApp.ms)),
      node('span', 'highlight__sub', topApp.exe)
    )
    cards.push(card)
  }
  // hidden 与子节点永远一致：要么三张卡片可见，要么整块隐藏且没有子节点
  if (cards.length === 0) {
    ui.highlights.replaceChildren()
    ui.highlights.hidden = true
    return
  }
  ui.highlights.replaceChildren(...cards)
  ui.highlights.hidden = false
}

/* 海报 --------------------------------------------------------------- */

async function exportPoster(): Promise<void> {
  if (state.day.scenes.length === 0) {
    toast('当天还没有素材，无法导出海报')
    return
  }
  ui.exportPosterBtn.disabled = true
  try {
    const layout = computePoster({
      day: state.day,
      projects: state.settings.projects,
      note: state.note
    })
    const canvas = document.createElement('canvas')
    canvas.width = layout.width
    canvas.height = layout.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建海报画布')
    paintPoster(ctx, layout)
    const base64 = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
    const path = await state.source.saveImage(`dayfilm-${state.date}.png`, base64)
    toast(path.length > 0 ? `海报已导出：${path}` : '已取消导出海报')
  } catch (error) {
    toast(`海报导出失败：${messageOf(error)}`)
  } finally {
    ui.exportPosterBtn.disabled = false
  }
}

/* 项目规则（设置面板） ----------------------------------------------- */

function renderProjectCards(): void {
  const rules = state.settings.projects
  if (rules.length === 0) {
    ui.projectCards.replaceChildren(node('p', 'hint', '还没有项目规则'))
    return
  }
  ui.projectCards.replaceChildren(
    ...rules.map((rule) => {
      const card = node('div', 'project')
      const head = node('div', 'project__head')
      head.append(node('strong', 'project__name', rule.name))
      const remove = node('button', 'project__remove', '删除')
      remove.type = 'button'
      remove.dataset.project = rule.name
      remove.setAttribute('aria-label', `删除项目 ${rule.name}`)
      head.append(remove)
      card.append(head, node('p', 'project__terms', rule.terms.join('、')))
      return card
    })
  )
}

function splitTerms(input: string): string[] {
  return input
    .split(/[,，、]/)
    .map((term) => term.trim())
    .filter(Boolean)
}

async function addProject(): Promise<void> {
  const name = ui.projectName.value.trim()
  const terms = splitTerms(ui.projectTerms.value)
  if (name.length === 0) {
    setPanelStatus('项目名不能为空', 'error')
    return
  }
  if (terms.length === 0) {
    setPanelStatus('至少填一个关键词', 'error')
    return
  }
  if (state.settings.projects.some((rule) => rule.name === name)) {
    setPanelStatus('已经有同名项目', 'error')
    return
  }
  const saved = await applySettings({ projects: [...state.settings.projects, { name, terms }] })
  if (saved) {
    ui.projectName.value = ''
    ui.projectTerms.value = ''
  }
}

function removeProject(name: string): void {
  void applySettings({ projects: state.settings.projects.filter((rule) => rule.name !== name) })
}

/* 一周电影 ----------------------------------------------------------- */

function shiftDate(dateISO: string, days: number): string {
  const date = new Date(startOfDay(dateISO))
  date.setDate(date.getDate() + days)
  return isoDate(date.getTime())
}

/** 周模式取一天的数据：今天用实时状态，其余读缓存。 */
function cachedDay(date: string): DayRollup | null {
  const today = isoDate(Date.now())
  if (date > today) return null
  if (date === today && state.live !== null) return state.live.day
  return state.weekCache.get(date) ?? null
}

/** 本周 + 上周各 7 天，只补还没缓存的日期。 */
async function ensureWeekDays(): Promise<void> {
  const today = isoDate(Date.now())
  const dates = [...weekDates(state.weekMonday), ...weekDates(shiftDate(state.weekMonday, -7))]
  const missing = dates.filter((date) => date <= today && !state.weekCache.has(date))
  await Promise.all(
    missing.map(async (date) => {
      try {
        state.weekCache.set(date, await state.source.getDay(date))
      } catch {
        state.weekCache.set(date, null)
      }
    })
  )
}

/** 用缓存重建周模型并重绘（不发请求，tick 与设置变化都走这里）。 */
function refreshWeekFilm(): void {
  if (state.weekMonday === '') return
  const thisDates = weekDates(state.weekMonday)
  const lastDates = weekDates(shiftDate(state.weekMonday, -7))
  state.weekThisDays = thisDates.map((date) => ({ date, day: cachedDay(date) }))
  state.weekLastDays = lastDates.map((date) => ({ date, day: cachedDay(date) }))
  state.weekFilm = buildWeekFilm({
    days: state.weekThisDays,
    projects: state.settings.projects,
    today: isoDate(Date.now()),
    previousSunday: { date: lastDates[6], day: cachedDay(lastDates[6]) }
  })
  renderWeekFilm()
}

async function loadWeekFilm(): Promise<void> {
  if (state.weekLoading) return
  state.weekLoading = true
  try {
    await ensureWeekDays()
    refreshWeekFilm()
  } finally {
    state.weekLoading = false
  }
}

function setMode(mode: 'day' | 'week'): void {
  state.mode = mode
  if (appRoot !== null) appRoot.dataset.mode = mode
  ui.modeDay.classList.toggle('is-active', mode === 'day')
  ui.modeWeek.classList.toggle('is-active', mode === 'week')
  ui.modeDay.setAttribute('aria-pressed', String(mode === 'day'))
  ui.modeWeek.setAttribute('aria-pressed', String(mode === 'week'))
  ui.weekFilm.hidden = mode !== 'week'
  if (mode === 'week') {
    if (state.weekMonday === '') state.weekMonday = mondayOf(isoDate(Date.now()))
    refreshWeekFilm()
    void loadWeekFilm()
    return
  }
  // 回到日模式：胶片刚重新可见，重新量一次尺寸再画
  measure()
  renderRuler()
  updateMarkers()
}

/** 周模式下点任何镜头：切回日模式、载入该天、选中该镜头。 */
async function gotoDay(date: string, sceneId?: string): Promise<void> {
  if (state.mode !== 'day') setMode('day')
  if (state.date !== date) await loadDate(date)
  if (sceneId === undefined) return
  const scene = state.day.scenes.find((item) => item.id === sceneId)
  if (!scene) return
  selectScene(scene)
  revealRow(scene.id, 'center')
}

function firstEntryOfLine(date: string, line: string): WeekEntry | null {
  const projects = state.settings.projects
  for (const entry of state.weekFilm?.entries ?? []) {
    if (entry.date !== date) continue
    const name = projects.length > 0 ? matchProject(entry.scene, projects) : entry.scene.exe
    if (name === line) return entry
  }
  return null
}

/** 幕卡片第一行的文字：未来 / 无采集 / 有记录无镜头 / 主线。 */
function arcLabel(act: ActModel, column: StoryColumn): string {
  if (act.future) return '未到'
  if (column.noRecord) return '没有采样'
  if (!act.hasData) return '没有镜头'
  return act.mainLine ?? '未归项目'
}

function renderArcs(film: WeekFilm): void {
  const cards = film.acts.map((act, index) => {
    const column = film.columns[index]
    const card = node('button', 'arc')
    card.type = 'button'
    card.dataset.date = act.date
    card.setAttribute('aria-label', `${act.date} ${act.weekday} ${arcLabel(act, column)}`)
    if (!act.hasData) card.classList.add('arc--empty')
    if (act.future) card.classList.add('arc--future')
    // 固定两行：日期 + 主线 / 最长与剪辑（徽标跟在第二行末尾）
    const head = node('div', 'arc__head')
    head.append(
      node('span', 'arc__when', `${act.date.slice(5)} ${act.weekday}`),
      node('span', 'arc__line', arcLabel(act, column))
    )
    card.append(head)
    if (act.hasData) {
      const meta = node('div', 'arc__meta')
      meta.append(
        node('span', 'arc__meta-text', `最长 ${fmtDuration(act.longestSeconds)} · ${act.cuts} 次剪辑`)
      )
      for (const badge of act.badges) {
        meta.append(node('span', badge.kind === 'switch' ? 'tag tag--switch' : 'tag', badge.text))
      }
      card.append(meta)
    }
    return card
  })
  ui.weekArcs.replaceChildren(...cards)
}

/** 矩阵列头：日期 + 星期一行，切 / 回 / 无记录写在下面。 */
function storyColumnNode(column: StoryColumn): HTMLElement {
  const head = node('div', 'story__col')
  if (column.noRecord) {
    head.classList.add('story__col--norecord')
    head.dataset.date = column.date
    head.dataset.norecord = 'true'
    head.setAttribute(
      'aria-label',
      `${column.date} ${column.weekday}，当天无采样，点击查看该天`
    )
    head.setAttribute('role', 'button')
    head.tabIndex = 0
    head.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      void gotoDay(column.date)
    })
  }
  head.append(
    node('span', 'story__col-when', `${column.date.slice(5)} ${column.weekday}`),
    node('span', 'story__mark', column.noRecord ? '无记录' : column.mark ?? '')
  )
  return head
}

function renderStory(film: WeekFilm): void {
  const grid = node('div', 'story__grid')
  grid.append(node('div', 'story__corner'))
  for (const column of film.columns) grid.append(storyColumnNode(column))
  for (const row of film.rows) {
    const name = node('div', 'story__name')
    const swatch = node('i', 'story__swatch')
    swatch.style.background = `hsl(${row.hue} 26% 58%)`
    name.append(
      swatch,
      node('span', 'story__name-text', row.line),
      node('span', 'story__total', fmtMinutes(row.totalMs))
    )
    grid.append(name)
    for (const cell of row.cells) {
      const button = node('button', 'story__cell')
      button.type = 'button'
      if (cell.future) {
        button.classList.add('story__cell--future')
        button.disabled = true
        button.setAttribute('aria-label', `${row.line} ${cell.date} 未到`)
      } else if (cell.noRecord) {
        // 整列没有采集：与日期下拉一致，点它去那天（不抢 Tab 焦点）
        button.classList.add('story__cell--norecord')
        button.dataset.date = cell.date
        button.dataset.norecord = 'true'
        button.tabIndex = -1
        button.setAttribute('aria-label', `${row.line} ${cell.date} 当天无采样，点击查看该天`)
      } else if (cell.ms > 0) {
        button.dataset.date = cell.date
        button.dataset.line = row.line
        button.style.background = `hsl(${row.hue} 24% 56% / ${cell.alpha})`
        button.title = `${row.line} · ${fmtMinutes(cell.ms)}`
        button.setAttribute(
          'aria-label',
          `${row.line} ${cell.date} ${fmtMinutes(cell.ms)}，点击查看当天该项目的第一个镜头`
        )
      } else {
        // 当天有这个项目以外的事，但这个项目没有：不可点、不可聚焦
        button.classList.add('story__cell--empty')
        button.disabled = true
        button.setAttribute('aria-label', `${row.line} ${cell.date} 没有记录`)
      }
      if (cell.protagonist) button.classList.add('story__cell--protagonist')
      if (cell.link) {
        const link = node('i', 'story__link')
        link.style.background = `hsl(${row.hue} 30% 62%)`
        button.append(link)
      }
      grid.append(button)
    }
  }
  const children: HTMLElement[] = [grid]
  if (state.settings.projects.length === 0) {
    children.push(node('p', 'story__hint', '在设置里加一条项目规则，故事线会更清楚。'))
  }
  ui.storyline.replaceChildren(...children)
}

function renderWeekVerdict(): void {
  const verdict = buildWeekVerdict(state.weekThisDays, state.weekLastDays, isoDate(Date.now()))
  ui.weekVerdict.textContent = verdict.sentence
  const table = node('table', 'evidence')
  const head = node('thead')
  const headRow = node('tr')
  headRow.append(node('th', undefined, '指标'))
  for (const item of verdict.evidence) headRow.append(node('th', undefined, item.label))
  head.append(headRow)
  const body = node('tbody')
  const rows: [string, (item: (typeof verdict.evidence)[number]) => string][] = [
    ['本周', (item) => item.current],
    ['上周', (item) => item.previous],
    ['变化', (item) => item.delta]
  ]
  for (const [label, picker] of rows) {
    const tr = node('tr')
    tr.append(node('th', undefined, label))
    for (const item of verdict.evidence) tr.append(node('td', undefined, picker(item)))
    body.append(tr)
  }
  table.append(head, body)
  ui.weekEvidenceBody.replaceChildren(table)
}

function renderWeekPicks(film: WeekFilm): void {
  const picks = pickWeekHighlights(film, state.settings.projects)
  if (picks.length === 0) {
    ui.weekPicks.replaceChildren(node('p', 'week-picks__empty', '这一周还没有镜头。'))
    return
  }
  const today = isoDate(Date.now())
  ui.weekPicks.replaceChildren(
    ...picks.map((pick) => {
      const card = node('button', 'pick')
      card.type = 'button'
      card.dataset.date = pick.date
      card.dataset.id = pick.scene.id
      card.append(
        node('span', 'pick__reason', pick.reason),
        node(
          'span',
          'pick__time',
          `${fmtDateLabel(pick.date, today)} ${fmtClock(pick.scene.start)}–${fmtClock(pick.scene.end)}`
        ),
        node('span', 'pick__title', pick.scene.title || '—'),
        node('span', 'pick__meta', `${pick.scene.exe} · ${fmtDuration(pick.scene.seconds)}`)
      )
      return card
    })
  )
}

function renderWeekFilm(): void {
  const film = state.weekFilm
  if (film === null) {
    ui.weekRange.textContent = '—'
    return
  }
  ui.weekRange.textContent = weekRangeLabel(film.monday)
  renderArcs(film)
  renderStory(film)
  renderWeekVerdict()
  renderWeekPicks(film)
  const thisMonday = mondayOf(isoDate(Date.now()))
  ui.weekToday.disabled = film.monday === thisMonday
  ui.weekNext.disabled = film.monday >= thisMonday
}

/** 项目等设置变化后，周视图也要跟着重算。 */
function refreshWeekIfVisible(): void {
  if (state.weekFilm !== null) refreshWeekFilm()
}

function bindEvents(): void {
  ui.date.addEventListener('change', () => {
    // 换日期就是看那一天，先退出检索
    ui.search.value = ''
    state.results = null
    resetListScroll()
    void loadDate(ui.date.value)
  })
  ui.search.addEventListener('input', scheduleSearch)
  ui.exportBtn.addEventListener('click', () => {
    void exportDay()
  })
  ui.playBtn.addEventListener('click', togglePlay)
  for (const button of ui.speedBtns) {
    button.addEventListener('click', () => {
      const speed = Number(button.dataset.speed)
      if (speed === 60 || speed === 600 || speed === 3600) setSpeed(speed)
    })
  }
  ui.scrub.addEventListener('input', () => {
    pause()
    seek(dayStart() + Number(ui.scrub.value) * 60_000)
  })
  ui.track.addEventListener('keydown', onTrackKey)
  ui.track.addEventListener('pointerenter', () => {
    trackRect = ui.track.getBoundingClientRect()
  })
  ui.track.addEventListener('pointermove', (event) => {
    onHover(event)
    onTrackPointerMove(event)
  })
  ui.track.addEventListener('pointerdown', onTrackPointerDown)
  ui.track.addEventListener('pointerup', onTrackPointerUp)
  ui.track.addEventListener('pointercancel', onTrackPointerUp)
  ui.track.addEventListener('pointerleave', hideTip)
  ui.track.addEventListener('wheel', onWheel, { passive: false })
  ui.listScroll.addEventListener('scroll', onListScroll)
  ui.settingsBtn.addEventListener('click', openPanel)
  ui.drawerScrim.addEventListener('click', closePanel)
  ui.panelClose.addEventListener('click', closePanel)
  document.addEventListener('keydown', onPanelKey)
  ui.retention.addEventListener('change', () => {
    void applySettings({ retentionDays: Number(ui.retention.value) })
  })
  ui.termForm.addEventListener('submit', (event) => {
    event.preventDefault()
    void addTerm()
  })
  ui.termChips.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const button = target.closest<HTMLElement>('[data-term]')
    const term = button?.dataset.term
    if (term) removeTerm(term)
  })
  ui.autoStart.addEventListener('change', () => {
    void applySettings({ autoStart: ui.autoStart.checked })
  })
  ui.pausedToggle.addEventListener('change', () => {
    void applySettings({ paused: ui.pausedToggle.checked })
  })
  ui.quitBtn.addEventListener('click', () => {
    void quitApp()
  })
  ui.zoomIn.addEventListener('click', () => zoomBy(1.6))
  ui.zoomOut.addEventListener('click', () => zoomBy(1 / 1.6))
  ui.zoomReset.addEventListener('click', () => applyView(fullDay(dayStart())))
  ui.exportPosterBtn.addEventListener('click', () => {
    void exportPoster()
  })
  ui.note.addEventListener('input', onNoteInput)
  ui.projectForm.addEventListener('submit', (event) => {
    event.preventDefault()
    void addProject()
  })
  ui.projectCards.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const button = target.closest<HTMLElement>('[data-project]')
    const name = button?.dataset.project
    if (name) removeProject(name)
  })
  ui.week.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const button = target.closest<HTMLElement>('[data-date]')
    const date = button?.dataset.date
    if (date && date !== state.date) void selectDay(date)
  })
  ui.modeDay.addEventListener('click', () => setMode('day'))
  ui.modeWeek.addEventListener('click', () => setMode('week'))
  ui.weekPrev.addEventListener('click', () => {
    state.weekMonday = shiftDate(state.weekMonday, -7)
    void loadWeekFilm()
  })
  ui.weekNext.addEventListener('click', () => {
    const next = shiftDate(state.weekMonday, 7)
    if (next > mondayOf(isoDate(Date.now()))) return
    state.weekMonday = next
    void loadWeekFilm()
  })
  ui.weekToday.addEventListener('click', () => {
    state.weekMonday = mondayOf(isoDate(Date.now()))
    void loadWeekFilm()
  })
  ui.weekArcs.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const card = target.closest<HTMLElement>('[data-date]')
    const date = card?.dataset.date
    if (date) void gotoDay(date)
  })
  ui.storyline.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const holder = target.closest<HTMLElement>('[data-date]')
    const date = holder?.dataset.date
    if (!date) return
    const line = holder?.dataset.line
    if (line) {
      void gotoDay(date, firstEntryOfLine(date, line)?.scene.id)
      return
    }
    // 没有 data-line：整列没有采样，按日期下拉的语义切到那天
    void gotoDay(date)
  })
  ui.weekPicks.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const card = target.closest<HTMLElement>('.pick')
    const date = card?.dataset.date
    const id = card?.dataset.id
    if (date) void gotoDay(date, id)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause()
  })
  window.setInterval(() => {
    updateElapsed()
    updateMarkers()
  }, 1000)
}

export async function boot(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#app')
  if (!root) return
  appRoot = root
  ui = collect(root)
  renderRuler()

  const source = createSource()
  const dates = await source.listDays()
  const today = isoDate(Date.now())
  // 当天即使还没有日文件也默认今天并走空状态，不能退回昨天
  const date = today
  const [day, live] = await Promise.all([source.getDay(date), source.live()])

  state = {
    source,
    date,
    dates,
    day,
    live,
    anchor: { wall: Date.now(), now: live.now },
    selectedId: null,
    results: null,
    playing: false,
    speed: 600,
    playhead: 0,
    settings: { ...DEFAULT_SETTINGS, redactTerms: [], projects: [] },
    settingsReady: false,
    panelOpen: false,
    browsingHistory: false,
    datesRefreshedFor: null,
    view: fullDay(startOfDay(date)),
    weekDates: [],
    weekDays: [],
    note: '',
    noteSaved: '',
    mode: 'day',
    weekMonday: mondayOf(today),
    weekCache: new Map(),
    weekThisDays: [],
    weekLastDays: [],
    weekFilm: null,
    weekLoading: false
  }
  state.playhead = initialPlayhead()

  renderDates()
  renderSettingsStatic()
  renderSettings()
  renderLive()
  setSpeed(state.speed)
  measure()
  renderDay()
  renderRuler()
  updateZoomLevel()
  bindEvents()

  void loadStripWeek()
  void loadNote(date)
  void loadSettings()

  const observer = new ResizeObserver(measure)
  observer.observe(ui.track)
  observer.observe(ui.listScroll)
  source.onTick(handleTick)
}
