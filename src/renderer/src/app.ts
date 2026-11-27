/** 界面主体：构建骨架、维护状态、把状态写进 DOM。数据只来自 DayfilmSource。 */
import type {
  DayRollup,
  EpisodeRef,
  LiveState,
  Scene,
  SceneMark,
  SearchOutcome,
  SearchReason
} from '../../shared/types'
import {
  AUTO_EXTRA_OPTIONS,
  BUILTIN_REDACT_TERMS,
  DEFAULT_SETTINGS,
  RETENTION_OPTIONS,
  type ProjectRule,
  type Settings
} from '../../shared/settings'
import { createSource, type DayfilmSource } from './data'
import { createSelect, type SelectHandle } from './select'
import { findDiscoveries } from './lib/discover'
import { afterLongestShot, longestIntermission } from './lib/day-insights'
import {
  buildDiscoveryRows,
  createRequestToken,
  episodeText,
  intermissionText,
  reasonText,
  searchEmptyCopy,
  type RowDeps
} from './lib/hero-rows'
import { sceneAt } from './lib/reel'
import type { StoryCandidate } from '../../shared/stories'
import { pickHighlights } from './lib/highlights'
import { computePoster, type PosterTheme } from './lib/poster'
import {
  compareDays,
  deltaDirection,
  formatDelta,
  type CompareDiffItem,
  type CompareResult,
  type CompareSide
} from './lib/compare-days'
import { CALENDAR_DAYS, calendarCells, calendarDates, cellPalette, type CalendarCell, type CalendarDay } from './lib/calendar'
import {
  SPINE_FRAME_H,
  SPINE_FRAME_MS,
  spineFrameIndex,
  spineFrames,
  spineHeight,
  visibleSpineFrames
} from './lib/spine'
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
  fmtClock,
  fmtDateLabel,
  fmtDuration,
  fmtElapsed,
  fmtMinutes,
  isoDate,
  startOfDay
} from './lib/time'
import { paintCompareStrip, paintPoster, paintSpine, sizeCanvas } from './paint'
import {
  onStillFontsReady,
  paintProjectionBoard,
  paintProjectionGap,
  stillDataUrl
} from './paint-still'
import { shotOrdinals } from './lib/still-frame'
import { hashString } from './lib/hash'
import { pickNarration, type Narration } from './lib/narration'
import { TITLE_CARD_MS, shouldPlayTitleCard } from './lib/title-card'
import { projectionFrameParams } from './lib/projection-frame'
import { familyColor } from './lib/still-frame'
import { exeHue } from './lib/still'
import { createProjectorAudio } from './projection-audio'
import {
  EMPTY_PROJECTION,
  advanceProjection,
  cutsPerSecond,
  enterProjection,
  exitProjection,
  filmBounds,
  projectionFinished,
  playbackRange,
  playbackStart,
  setProjectionSound,
  setProjectionSpeed,
  showCutRate,
  type ProjectionState
} from './lib/projection'
import { followDate } from './lib/date-follow'
import { revealScrollTop, windowRange } from './lib/window'

const DAY_MS = 86_400_000
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
  /** 检索结果；null 表示正在看当天胶片 */
  search: SearchOutcome | null
  playing: boolean
  speed: Speed
  playhead: number
  settings: Settings
  /** 设置是否已从主进程读回；未读回时面板显示加载*/
  settingsReady: boolean
  panelOpen: boolean
  /** 用户主动选了历史日期；true 时跨零点不把视图拉回今天 */
  browsingHistory: boolean
  /** 已为哪一天补拉过日期列表，避免同一天反复刷*/
  datesRefreshedFor: string | null
  /** 当前日期的导演手*/
  note: string
  noteSaved: string
  /** day = 胶片视图，week = 一周电*/
  mode: 'day' | 'week'
  /** 周模式当前显示的周的周一 */
  weekMonday: string
  /** 周模式的数据缓存：日当天汇总（null 表示读取失败/没有数据*/
  weekCache: Map<string, DayRollup | null>
  weekThisDays: WeekDay[]
  weekLastDays: WeekDay[]
  weekFilm: WeekFilm | null
  weekLoading: boolean
  /** 对比浮层：两个日期与已取回的一天 */
  compareOpen: boolean
  compareDates: { left: string; right: string }
  compareCache: Map<string, DayRollup | null>
  /** 日历浮层：已载入的天（失败按无数据记） */
  calendarOpen: boolean
  calendarDays: Map<string, CalendarDay>
  calendarLoading: boolean
  /** 设置抽屉当前分区 */
  settingsSection: SettingsSection
  /** 正在行内编辑的项目名；null 表示没有在编辑 */
  editingProject: string | null
  /** 故事线候选：null 表示还没点过按钮 */
  candidates: StoryCandidate[] | null
  candidateNote: string | null
}

export type SettingsSection = 'collect' | 'projects' | 'model' | 'resident' | 'system'

interface Ui {
  date: HTMLElement
  search: HTMLInputElement
  chip: HTMLElement
  chipText: HTMLElement
  banner: HTMLElement
  bannerText: HTMLElement
  storageBanner: HTMLElement
  storageText: HTMLElement
  notice: HTMLElement
  shootingChip: HTMLElement
  liveText: HTMLElement
  elapsed: HTMLElement
  genre: HTMLElement
  verdict: HTMLElement
  intermission: HTMLElement
  liveExe: HTMLElement
  liveTitle: HTMLElement
  heroFrame: HTMLElement
  heroStill: HTMLElement
  heroFrameTag: HTMLElement
  heroFrameEmpty: HTMLElement
  heroFrameEmptyTitle: HTMLElement
  heroFrameEmptyText: HTMLElement
  metricShot: HTMLElement
  metricLongest: HTMLElement
  metricProject: HTMLElement
  note: HTMLTextAreaElement
  noteCount: HTMLElement
  noteStatus: HTMLElement
  highlights: HTMLElement
  spineScroll: HTMLElement
  spineSpacer: HTMLElement
  spineCanvas: HTMLCanvasElement
  playBtn: HTMLButtonElement
  speedBtns: HTMLButtonElement[]
  scrub: HTMLInputElement
  timecode: HTMLElement
  metrics: HTMLElement
  longestShot: HTMLElement
  longestRest: HTMLElement
  projectTotals: HTMLElement
  statMarks: HTMLElement
  statCuts: HTMLElement
  statCutsValue: HTMLElement
  listCount: HTMLElement
  listScroll: HTMLElement
  spacer: HTMLElement
  list: HTMLElement
  empty: HTMLElement
  searchNote: HTMLElement
  episode: HTMLElement
  announce: HTMLElement
  exportMenuBtn: HTMLButtonElement
  exportMenu: HTMLElement
  exportScriptBtn: HTMLButtonElement
  exportPdfBtn: HTMLButtonElement
  exportEdlBtn: HTMLButtonElement
  settingsBtn: HTMLButtonElement
  moreMenuBtn: HTMLButtonElement
  moreMenu: HTMLElement
  compareOpenBtn: HTMLButtonElement
  calendarOpenBtn: HTMLButtonElement
  drawer: HTMLElement
  drawerScrim: HTMLElement
  panel: HTMLElement
  panelClose: HTMLButtonElement
  panelStatus: HTMLElement
  settingsNav: HTMLElement
  settingsPane: HTMLElement
  navCountProjects: HTMLElement
  retention: HTMLElement
  termChips: HTMLElement
  termForm: HTMLFormElement
  termInput: HTMLInputElement
  autoStart: HTMLInputElement
  autoExtra: HTMLElement
  soundModeProjector: HTMLButtonElement
  soundModeCuts: HTMLButtonElement
  soundVolume: HTMLInputElement
  soundVolumeValue: HTMLElement
  markUnder10: HTMLButtonElement
  markAuto: HTMLButtonElement
  markClear: HTMLButtonElement
  pausedToggle: HTMLInputElement
  hudToggle: HTMLInputElement
  quitBtn: HTMLButtonElement
  builtinTerms: HTMLElement
  builtinCount: HTMLElement
  compare: HTMLElement
  compareScrim: HTMLElement
  compareClose: HTMLButtonElement
  compareLeft: HTMLElement
  compareRight: HTMLElement
  compareChart: HTMLElement
  compareDiff: HTMLElement
  calendar: HTMLElement
  calendarScrim: HTMLElement
  calendarClose: HTMLButtonElement
  calendarGrid: HTMLElement
  calendarProgress: HTMLElement
  calendarLegend: HTMLElement
  projectCards: HTMLElement
  projectForm: HTMLFormElement
  projectName: HTMLInputElement
  projectTerms: HTMLInputElement
  projection: HTMLElement
  projectionStage: HTMLElement
  projectionFrame: HTMLCanvasElement
  shotCounter: HTMLElement
  projectionClock: HTMLElement
  projectionCuts: HTMLElement
  projectionIndex: HTMLElement
  projectionTitle: HTMLElement
  projectionSubtitle: HTMLElement
  projectionSubtitleIndex: HTMLElement
  projectionSubtitleText: HTMLElement
  titleCard: HTMLElement
  titleCardDate: HTMLElement
  titleCardVerdict: HTMLElement
  projectionStrip: HTMLElement
  projectionStripCanvas: HTMLCanvasElement
  projectionHead: HTMLElement
  soundToggle: HTMLButtonElement
  audioMeter: HTMLElement
  exitProjection: HTMLButtonElement
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
  winMin: HTMLButtonElement
  winMax: HTMLButtonElement
  winClose: HTMLButtonElement
  winMaxIcon: SVGElement
  winRestoreIcon: SVGElement
  dragRegion: HTMLElement
  onboarding: HTMLElement
  onboardStart: HTMLButtonElement
  onboardSettings: HTMLButtonElement
  discoveries: HTMLElement
  candidateList: HTMLElement
  findCandidates: HTMLButtonElement
  aiCandidates: HTMLButtonElement
  candidateHint: HTMLElement
  aiEnabled: HTMLInputElement
  aiBaseUrl: HTMLInputElement
  aiModel: HTMLInputElement
  aiKey: HTMLInputElement
  aiSave: HTMLButtonElement
  aiProbe: HTMLButtonElement
  aiKeyClear: HTMLButtonElement
  aiStatus: HTMLElement
}

let state!: State
let ui!: Ui
let frameKey = ''
let timecodeKey = ''
let searchTimer = 0
let noticeTimer = 0
let rowStride = FALLBACK_ROW_STRIDE
let listViewport = 0
let listSignature = ''
let windowSignature = ''
let scrollRaf = 0
let panelStatusTimer = 0
let noteTimer = 0
let appRoot: HTMLElement | null = null
let projection: ProjectionState = EMPTY_PROJECTION
let projectionRaf = 0
let projectionLast = 0
let projectionCutsText = ''
let compareResult: CompareResult | null = null
let compareRenderToken = 0
let dateSelect: SelectHandle | null = null
let retentionSelect: SelectHandle | null = null
let autoExtraSelect: SelectHandle | null = null
let windowMaximized = false

/** 主进程并行改无边框窗口；未就绪时全部可选调用。 */
interface WindowBridge {
  minimize?(): void
  toggleMaximize?(): void
  close?(): void
  onMaximizeChange?(cb: (maximized: boolean) => void): () => void
}
// SAFETY: 主进程并行改窗口，bridge 可能缺席或落后于渲染进程；这里只按可选成员调用
const windowBridge = (window as unknown as { dayfilmWindow?: WindowBridge }).dayfilmWindow
const projectorAudio = createProjectorAudio()

function dayStart(): number {
  return startOfDay(state.date)
}

function effectiveNow(): number {
  return state.anchor.now + (Date.now() - state.anchor.wall)
}

function isToday(): boolean {
  return state.date === isoDate(Date.now())
}

/** 回放的上界：今天现在"，历史日到最后一个镜头*/
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
    date: pick<HTMLElement>('date'),
    search: pick<HTMLInputElement>('search'),
    chip: pick<HTMLElement>('chip'),
    chipText: pick<HTMLElement>('chipText'),
    banner: pick<HTMLElement>('banner'),
    bannerText: pick<HTMLElement>('bannerText'),
    storageBanner: pick<HTMLElement>('storageBanner'),
    storageText: pick<HTMLElement>('storageText'),
    notice: pick<HTMLElement>('notice'),
    shootingChip: pick<HTMLElement>('shootingChip'),
    liveText: pick<HTMLElement>('liveText'),
    elapsed: pick<HTMLElement>('elapsed'),
    genre: pick<HTMLElement>('genre'),
    verdict: pick<HTMLElement>('verdict'),
    intermission: pick<HTMLElement>('intermission'),
    liveExe: pick<HTMLElement>('liveExe'),
    liveTitle: pick<HTMLElement>('liveTitle'),
    heroFrame: pick<HTMLElement>('heroFrame'),
    heroStill: pick<HTMLElement>('heroStill'),
    heroFrameTag: pick<HTMLElement>('heroFrameTag'),
    heroFrameEmpty: pick<HTMLElement>('heroFrameEmpty'),
    heroFrameEmptyTitle: pick<HTMLElement>('heroFrameEmptyTitle'),
    heroFrameEmptyText: pick<HTMLElement>('heroFrameEmptyText'),
    metricShot: pick<HTMLElement>('metricShot'),
    metricLongest: pick<HTMLElement>('metricLongest'),
    metricProject: pick<HTMLElement>('metricProject'),
    note: pick<HTMLTextAreaElement>('note'),
    noteCount: pick<HTMLElement>('noteCount'),
    noteStatus: pick<HTMLElement>('noteStatus'),
    highlights: pick<HTMLElement>('highlights'),
    spineScroll: pick<HTMLElement>('spineScroll'),
    spineSpacer: pick<HTMLElement>('spineSpacer'),
    spineCanvas: pick<HTMLCanvasElement>('spineCanvas'),
    playBtn: pick<HTMLButtonElement>('play'),
    speedBtns: [...root.querySelectorAll<HTMLButtonElement>('.speed')],
    scrub: pick<HTMLInputElement>('scrub'),
    timecode: pick<HTMLElement>('timecode'),
    metrics: pick<HTMLElement>('metrics'),
    longestShot: pick<HTMLElement>('longestShot'),
    longestRest: pick<HTMLElement>('longestRest'),
    projectTotals: pick<HTMLElement>('projectTotals'),
    statMarks: pick<HTMLElement>('statMarks'),
    statCuts: pick<HTMLElement>('statCuts'),
    statCutsValue: pick<HTMLElement>('statCutsValue'),
    listCount: pick<HTMLElement>('listCount'),
    listScroll: pick<HTMLElement>('listScroll'),
    spacer: pick<HTMLElement>('listSpacer'),
    list: pick<HTMLElement>('list'),
    empty: pick<HTMLElement>('empty'),
    searchNote: pick<HTMLElement>('searchNote'),
    episode: pick<HTMLElement>('episode'),
    announce: pick<HTMLElement>('announce'),
    exportMenuBtn: pick<HTMLButtonElement>('exportMenuBtn'),
    exportMenu: pick<HTMLElement>('exportMenu'),
    exportScriptBtn: pick<HTMLButtonElement>('exportScript'),
    exportPdfBtn: pick<HTMLButtonElement>('exportPdf'),
    exportEdlBtn: pick<HTMLButtonElement>('exportEdl'),
    settingsBtn: pick<HTMLButtonElement>('settings'),
    moreMenuBtn: pick<HTMLButtonElement>('moreMenuBtn'),
    moreMenu: pick<HTMLElement>('moreMenu'),
    compareOpenBtn: pick<HTMLButtonElement>('compareOpen'),
    calendarOpenBtn: pick<HTMLButtonElement>('calendarOpen'),
    drawer: pick<HTMLElement>('drawer'),
    drawerScrim: pick<HTMLElement>('drawerScrim'),
    panel: pick<HTMLElement>('panel'),
    panelClose: pick<HTMLButtonElement>('panelClose'),
    panelStatus: pick<HTMLElement>('panelStatus'),
    settingsNav: pick<HTMLElement>('settingsNav'),
    settingsPane: pick<HTMLElement>('settingsPane'),
    navCountProjects: pick<HTMLElement>('navCountProjects'),
    retention: pick<HTMLElement>('settingRetention'),
    termChips: pick<HTMLElement>('termChips'),
    termForm: pick<HTMLFormElement>('termForm'),
    termInput: pick<HTMLInputElement>('termInput'),
    autoStart: pick<HTMLInputElement>('settingAutoStart'),
    autoExtra: pick<HTMLElement>('settingAutoExtra'),
    soundModeProjector: pick<HTMLButtonElement>('soundModeProjector'),
    soundModeCuts: pick<HTMLButtonElement>('soundModeCuts'),
    soundVolume: pick<HTMLInputElement>('soundVolume'),
    soundVolumeValue: pick<HTMLElement>('soundVolumeValue'),
    markUnder10: pick<HTMLButtonElement>('markUnder10'),
    markAuto: pick<HTMLButtonElement>('markAuto'),
    markClear: pick<HTMLButtonElement>('markClear'),
    pausedToggle: pick<HTMLInputElement>('settingPaused'),
    hudToggle: pick<HTMLInputElement>('settingHud'),
    quitBtn: pick<HTMLButtonElement>('quitBtn'),
    builtinTerms: pick<HTMLElement>('builtinTerms'),
    builtinCount: pick<HTMLElement>('builtinCount'),
    compare: pick<HTMLElement>('compare'),
    compareScrim: pick<HTMLElement>('compareScrim'),
    compareClose: pick<HTMLButtonElement>('compareClose'),
    compareLeft: pick<HTMLElement>('compareLeft'),
    compareRight: pick<HTMLElement>('compareRight'),
    compareChart: pick<HTMLElement>('compareChart'),
    compareDiff: pick<HTMLElement>('compareDiff'),
    calendar: pick<HTMLElement>('calendar'),
    calendarScrim: pick<HTMLElement>('calendarScrim'),
    calendarClose: pick<HTMLButtonElement>('calendarClose'),
    calendarGrid: pick<HTMLElement>('calendarGrid'),
    calendarProgress: pick<HTMLElement>('calendarProgress'),
    calendarLegend: pick<HTMLElement>('calendarLegend'),
    projectCards: pick<HTMLElement>('projectCards'),
    projectForm: pick<HTMLFormElement>('projectForm'),
    projectName: pick<HTMLInputElement>('projectName'),
    projectTerms: pick<HTMLInputElement>('projectTerms'),
    projection: pick<HTMLElement>('projection'),
    projectionStage: pick<HTMLElement>('projectionStage'),
    projectionFrame: pick<HTMLCanvasElement>('projectionFrame'),
    shotCounter: pick<HTMLElement>('shotCounter'),
    projectionClock: pick<HTMLElement>('projectionClock'),
    projectionCuts: pick<HTMLElement>('projectionCuts'),
    projectionIndex: pick<HTMLElement>('projectionIndex'),
    projectionTitle: pick<HTMLElement>('projectionTitle'),
    projectionSubtitle: pick<HTMLElement>('projectionSubtitle'),
    projectionSubtitleIndex: pick<HTMLElement>('projectionSubtitleIndex'),
    projectionSubtitleText: pick<HTMLElement>('projectionSubtitleText'),
    titleCard: pick<HTMLElement>('titleCard'),
    titleCardDate: pick<HTMLElement>('titleCardDate'),
    titleCardVerdict: pick<HTMLElement>('titleCardVerdict'),
    projectionStrip: pick<HTMLElement>('projectionStrip'),
    projectionStripCanvas: pick<HTMLCanvasElement>('projectionStripCanvas'),
    projectionHead: pick<HTMLElement>('projectionHead'),
    soundToggle: pick<HTMLButtonElement>('soundToggle'),
    audioMeter: pick<HTMLElement>('audioMeter'),
    exitProjection: pick<HTMLButtonElement>('exitProjection'),
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
    weekPicks: pick<HTMLElement>('weekPicks'),
    winMin: pick<HTMLButtonElement>('winMin'),
    winMax: pick<HTMLButtonElement>('winMax'),
    winClose: pick<HTMLButtonElement>('winClose'),
    winMaxIcon: pick<SVGElement>('winMaxIcon'),
    winRestoreIcon: pick<SVGElement>('winRestoreIcon'),
    dragRegion: pick<HTMLElement>('dragRegion'),
    onboarding: pick<HTMLElement>('onboarding'),
    onboardStart: pick<HTMLButtonElement>('onboardStart'),
    onboardSettings: pick<HTMLButtonElement>('onboardSettings'),
    discoveries: pick<HTMLElement>('discoveries'),
    candidateList: pick<HTMLElement>('candidateList'),
    findCandidates: pick<HTMLButtonElement>('findCandidates'),
    aiCandidates: pick<HTMLButtonElement>('aiCandidates'),
    candidateHint: pick<HTMLElement>('candidateHint'),
    aiEnabled: pick<HTMLInputElement>('aiEnabled'),
    aiBaseUrl: pick<HTMLInputElement>('aiBaseUrl'),
    aiModel: pick<HTMLInputElement>('aiModel'),
    aiKey: pick<HTMLInputElement>('aiKey'),
    aiSave: pick<HTMLButtonElement>('aiSave'),
    aiProbe: pick<HTMLButtonElement>('aiProbe'),
    aiKeyClear: pick<HTMLButtonElement>('aiKeyClear'),
    aiStatus: pick<HTMLElement>('aiStatus')
  }
}

function renderDates(): void {
  const today = isoDate(Date.now())
  // 今天可能还没有日文件：即使主进程没返回今天，也要让下拉框里有
  const dates = state.dates.includes(state.date) ? state.dates : [state.date, ...state.dates]
  dateSelect?.setOptions(
    dates.map((date) => ({ value: date, label: fmtDateLabel(date, today) })),
    state.date
  )
}

/** 重新拉一次日期列表（跨零点、保留期变更后）。失败时保留旧列表*/
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

  ui.banner.hidden = captureError === null
  ui.bannerText.textContent = captureError ?? ''
  ui.storageBanner.hidden = storageError === null
  ui.storageText.textContent = storageError ?? ''

  // 采集错误优先于暂停：出错时 chip 必须是红的
  let status: 'ok' | 'paused' | 'error' = 'ok'
  if (captureError !== null) status = 'error'
  else if (paused) status = 'paused'
  ui.chip.dataset.state = status
  let chipLabel = '实时记录中'
  if (status === 'error') chipLabel = '采集中断'
  else if (status === 'paused') chipLabel = '已暂停'
  ui.chipText.textContent = chipLabel

  // hero 的「正在拍摄」chip
  const shooting = !paused && scene !== null
  let chipState = 'idle'
  if (shooting) chipState = 'shooting'
  else if (paused) chipState = 'paused'
  ui.shootingChip.dataset.state = chipState
  let liveLabel = '空闲中'
  if (shooting) liveLabel = '正在拍摄'
  else if (paused) liveLabel = '已暂停'
  ui.liveText.textContent = liveLabel
  ui.elapsed.hidden = !shooting
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
  const viewport = ui.listScroll.clientHeight
  const stride = readRowStride()
  if (viewport !== listViewport || stride !== rowStride) {
    listViewport = viewport
    rowStride = stride
    windowSignature = ''
    renderWindow()
  }
  fitRecentList()
  paintSpineCanvas()
}

/** 最近镜头只显示整行，底部留 12px 内边距，不被面板底边切掉。 */
function fitRecentList(): void {
  const block = ui.listScroll.closest<HTMLElement>('.rail__block')
  if (block === null) return
  const head = block.querySelector('.rail__head')?.getBoundingClientRect().height ?? 0
  const cols = block.querySelector('.recent__cols')?.getBoundingClientRect().height ?? 0
  const style = getComputedStyle(block)
  const padY = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
  // 面板内高 − 表头 − 列头 − 两个 8px 间隔 − 8px 底部内距 → 行数取整
  const available = block.clientHeight - padY - head - cols - 16 - 8
  const rows = Math.max(1, Math.floor(available / rowStride))
  const target = rows * rowStride + 8
  if (Math.abs(ui.listScroll.getBoundingClientRect().height - target) > 0.5) {
    ui.listScroll.style.height = `${target}px`
  }
}

/** 行高由 CSS 变量 --row-stride 定义，只在尺寸变化时读一次。 */
function readRowStride(): number {
  const raw = getComputedStyle(ui.listScroll).getPropertyValue('--row-stride')
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) && value > 0 ? value : FALLBACK_ROW_STRIDE
}

/** 当天镜次表（只数 shot），按日数量缓存，回放时不会每帧重算*/
let ordinalKey = ''
let ordinalMap: Map<string, number> = new Map()
function dayOrdinals(): ReadonlyMap<string, number> {
  const scenes = state.day.scenes
  const key = `${state.date}|${scenes.length}`
  if (key !== ordinalKey) {
    ordinalKey = key
    ordinalMap = shotOrdinals(scenes)
  }
  return ordinalMap
}

function paintSpineCanvas(): void {
  const canvas = ui.spineCanvas
  const viewport = ui.spineScroll
  const spineWidth = viewport.clientWidth
  // 画布比脊柱宽 96px：右侧留出「现在」标签的位置
  const width = spineWidth + 96
  const height = viewport.clientHeight
  if (spineWidth <= 0 || height <= 0) return
  const ctx = sizeCanvas(canvas, width, height)
  if (!ctx) return
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const scrollTop = viewport.scrollTop
  const range = visibleSpineFrames(scrollTop, height)
  const offset = ((state.playhead - dayStart()) / SPINE_FRAME_MS) * SPINE_FRAME_H - scrollTop
  paintSpine(ctx, spineFrameData(), range, scrollTop, SPINE_FRAME_H, spineWidth, width, height, {
    y: offset,
    label: isToday() ? `现在 ${fmtClock(state.playhead)}` : fmtClock(state.playhead)
  }, {
    date: state.date,
    ordinals: dayOrdinals()
  })
}

let spineCache: { key: string; frames: ReturnType<typeof spineFrames> } | null = null

function spineFrameData(): ReturnType<typeof spineFrames> {
  const scenes = state.day.scenes
  const key = `${state.date}|${scenes.length}|${scenes[scenes.length - 1]?.end ?? 0}`
  if (spineCache?.key !== key) spineCache = { key, frames: spineFrames(state.day) }
  return spineCache.frames
}

/** 滚到某个时刻（放在视口中间），只在看不到时才动。 */
function revealSpine(ts: number): void {
  const viewport = ui.spineScroll
  const height = viewport.clientHeight
  if (height <= 0) return
  const y = ((ts - dayStart()) / SPINE_FRAME_MS) * SPINE_FRAME_H
  const top = viewport.scrollTop
  if (y < top + 48 || y > top + height - 48) {
    viewport.scrollTop = Math.max(0, Math.round(y - height / 2))
  }
}

/** 点脊柱：跳到该 10 分钟内的第一个镜头。 */
function onSpineClick(event: MouseEvent): void {
  const viewport = ui.spineScroll
  const rect = viewport.getBoundingClientRect()
  const y = event.clientY - rect.top + viewport.scrollTop
  const index = Math.min(143, Math.max(0, Math.floor(y / SPINE_FRAME_H)))
  const windowStart = dayStart() + index * SPINE_FRAME_MS
  const target = state.day.scenes.find(
    (scene) => scene.kind === 'shot' && scene.start >= windowStart && scene.start < windowStart + SPINE_FRAME_MS
  )
  if (target) selectScene(target)
  else seek(windowStart)
}

function onSpineKey(event: KeyboardEvent): void {
  const viewport = ui.spineScroll
  const page = Math.max(1, Math.floor(viewport.clientHeight / SPINE_FRAME_H)) * SPINE_FRAME_H
  const snap = (value: number): number => Math.round(value / SPINE_FRAME_H) * SPINE_FRAME_H
  if (event.key === 'Home') {
    event.preventDefault()
    viewport.scrollTo({ top: 0, behavior: 'smooth' })
  } else if (event.key === 'End') {
    event.preventDefault()
    viewport.scrollTo({ top: snap(viewport.scrollHeight), behavior: 'smooth' })
  } else if (event.key === 'PageDown') {
    event.preventDefault()
    viewport.scrollTo({ top: snap(viewport.scrollTop + page), behavior: 'smooth' })
  } else if (event.key === 'PageUp') {
    event.preventDefault()
    viewport.scrollTo({ top: snap(viewport.scrollTop - page), behavior: 'smooth' })
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    const index = spineFrameIndex(state.playhead, state.date)
    const windowStart = dayStart() + index * SPINE_FRAME_MS
    const target = state.day.scenes.find(
      (scene) => scene.kind === 'shot' && scene.start >= windowStart && scene.start < windowStart + SPINE_FRAME_MS
    )
    if (target) selectScene(target)
  } else {
    return
  }
  paintSpineCanvas()
}

/** 滚轮 = 一帧（32px）的整数倍，配合 CSS 的 smooth 滚动。 */
function onSpineWheel(event: WheelEvent): void {
  if (event.deltaY === 0) return
  event.preventDefault()
  const viewport = ui.spineScroll
  const base = Math.round(viewport.scrollTop / SPINE_FRAME_H) * SPINE_FRAME_H
  const step = event.deltaY > 0 ? SPINE_FRAME_H : -SPINE_FRAME_H
  viewport.scrollTo({ top: Math.max(0, base + step), behavior: 'smooth' })
}

function renderHero(): void {
  const day = state.day
  const hasData = day.scenes.length > 0
  ui.genre.textContent = hasData ? day.verdict.label : '未开镜'
  ui.genre.dataset.empty = String(!hasData)
  if (hasData) ui.verdict.textContent = day.verdict.note
  else if (isToday()) ui.verdict.textContent = '还没有拍摄任何素材，今天这卷胶片是空的。'
  else ui.verdict.textContent = '这一天没有采样，胶片是空的。'
  renderOnboarding()
  renderIntermission()
}

/** v4 S6：当天最长一段中场休息，只读一行；只说时长、次数与窗口名。 */
function renderIntermission(): void {
  const shape = longestIntermission(state.day)
  ui.intermission.hidden = shape === null
  ui.intermission.textContent = shape === null ? '' : intermissionText(shape)
}

/** 首次运行引导：只在当天没镜头且未确认过时显示。 */
const ONBOARDED_KEY = 'dayfilm.onboarded'

function onboardingSeen(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDED_KEY) === '1'
  } catch {
    return true
  }
}

function renderOnboarding(): void {
  // 开机 2 分钟内（featureMs < 120s）且没确认过才出引导；不再替换三指标，只是 hero 上的覆盖层
  const show = !onboardingSeen() && state.day.featureMs < 120_000
  ui.onboarding.hidden = !show
}

/** 镜头之间（含中场休息）最长的一段空档，秒。 */
function longestRestSeconds(day: DayRollup): number {
  let best = 0
  for (let index = 1; index < day.scenes.length; index += 1) {
    const gap = (day.scenes[index].start - day.scenes[index - 1].end) / 1000
    if (gap > best) best = gap
  }
  for (const scene of day.scenes) {
    if (scene.kind === 'intermission' && scene.seconds > best) best = scene.seconds
  }
  return Math.max(0, Math.round(best))
}

/** 统计区的活跃时长用 HH:MM（DESIGN §右栏：08:41 那种写法）。 */
function fmtHoursMinutes(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60_000))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** 右栏「今日统计」：三项数字 + 最长镜头/最长休息 + 项目一行。 */
function renderStats(): void {
  const day = state.day
  const shots = day.scenes.filter((scene) => scene.kind === 'shot')
  const metrics: [string, string][] = day.scenes.length === 0
    ? [
        ['活跃时长', '—'],
        ['镜头数', '—'],
        ['剪辑数', '—']
      ]
    : [
        ['活跃时长', fmtHoursMinutes(day.activeMs)],
        ['镜头数', String(shots.length)],
        ['剪辑数', String(day.cuts)]
      ]
  ui.metrics.replaceChildren(
    ...metrics.map(([label, value]) => {
      const cell = node('div', 'metric')
      cell.append(node('dt', 'metric__label', label), node('dd', 'metric__value', value))
      return cell
    })
  )
  const longest = day.longestShot
  ui.longestShot.textContent = longest
    ? `${fmtClock(longest.start)} · ${fmtDuration(longest.seconds)}`
    : '—'
  ui.metricLongest.textContent = longest ? fmtDuration(longest.seconds) : '—'
  ui.longestRest.textContent =
    day.scenes.length === 0 ? '—' : fmtDuration(longestRestSeconds(day))
  // 剪辑拆分单独一行：三列网格放第四个格子会掉到下一行、还带着左分隔线
  ui.statCuts.hidden = day.scenes.length === 0
  ui.statCutsValue.textContent = `跨应用 ${day.appCuts ?? 0} · 应用内 ${day.withinAppCuts ?? 0}`
  ui.statMarks.replaceChildren(
    (() => {
      const left = node('span', 'stats__marks-main')
      left.append(
        node('span', 'stats__marks-label', '正片'),
        node('b', 'stats__feature', fmtMinutes(day.featureMs))
      )
      return left
    })(),
    (() => {
      const autoMs = day.scenes
        .filter((scene) => scene.mark === 'extra' && scene.markSource === 'auto')
        .reduce((sum, scene) => sum + scene.seconds * 1000, 0)
      const extra = autoMs > 0
        ? `花絮 ${fmtMinutes(day.extraMs)}（含自动 ${fmtMinutes(autoMs)}）`
        : `花絮 ${fmtMinutes(day.extraMs)}`
      return node('span', 'stats__marks-extra', extra)
    })()
  )
  renderBulkState()
  renderProjectLine(day)
}

/** 项目汇总一行：按命中时长倒序，最多三项。 */
function renderProjectLine(day: DayRollup): void {
  const rules = state.settings.projects
  // 没有规则就不占位：说明文字不进统计区，想让项目出现就去设置里加一条
  ui.projectTotals.hidden = rules.length === 0
  if (rules.length === 0) {
    ui.projectTotals.textContent = ''
    return
  }
  const totals = totalByProject(day.scenes, rules).slice(0, 3)
  ui.projectTotals.textContent =
    totals.length === 0
      ? '项目：今天没有命中'
      : `项目：${totals.map((item) => `${item.name} ${fmtMinutes(item.ms)}`).join(' · ')}`
}

function buildRow(
  scene: Scene,
  withDate: boolean,
  index: number,
  total: number,
  reason?: SearchReason
): HTMLLIElement {
  const item = node('li', 'shot-row')
  item.setAttribute('aria-setsize', String(total))
  item.setAttribute('aria-posinset', String(index + 1))
  const button = node('button', scene.kind === 'intermission' ? 'shot shot--inter' : 'shot')
  button.type = 'button'
  button.dataset.id = scene.id

  const stamp = withDate ? `${isoDate(scene.start).slice(5)} ` : ''
  const title = scene.kind === 'intermission' ? '离开键盘' : scene.title || '—'
  const titleCell = node('span', 'shot__title')
  const project = scene.kind === 'shot' ? matchProject(scene, state.settings.projects) : null
  if (project) titleCell.append(node('span', 'shot__project', project))
  titleCell.append(node('span', 'shot__title-text', title))
  const extra = scene.mark === 'extra'
  if (extra) {
    button.classList.add('is-extra')
    const auto = scene.markSource === 'auto'
    titleCell.append(node('span', auto ? 'shot__mark is-auto' : 'shot__mark', auto ? '花絮（自动）' : '花絮'))
  }
  // 检索命中理由：和项目标签同一枚 chip，不新增样式
  if (reason) titleCell.append(node('span', 'shot__project shot__reason', reasonText(reason)))
  button.append(
    node('span', 'shot__clock', `${stamp}${fmtClock(scene.start)}`),
    titleCell,
    node('span', 'shot__exe', scene.kind === 'intermission' ? '中场休息' : scene.exe),
    node('span', 'shot__dur', fmtDuration(scene.seconds))
  )
  // hover 才出现的标记按钮：当前态琥珀底黑字
  if (scene.kind === 'shot') {
    const marks = node('span', 'shot__marks')
    for (const mark of ['feature', 'extra'] as const) {
      const btn = node('button', 'shot__mark-btn', mark === 'feature' ? '正片' : '花絮')
      btn.type = 'button'
      btn.dataset.mark = mark
      if (scene.mark === mark) btn.classList.add('is-active')
      btn.addEventListener('click', (event) => {
        event.stopPropagation()
        void markScene(scene, mark)
      })
      marks.append(btn)
    }
    button.append(marks)
  }
  button.addEventListener('click', () => {
    void locate(scene)
  })
  item.append(button)
  return item
}

/** 标记花絮 / 正片：拿主进程返回的当日汇总整份刷新。 */
async function markScene(scene: Scene, mark: SceneMark): Promise<void> {
  const next = scene.mark === mark ? null : mark
  try {
    const day = await state.source.setMark(state.date, scene.start, next)
    state.day = day
    if (state.live !== null && state.live.day.date === state.date) {
      state.live = { ...state.live, day }
    }
    listSignature = ''
    windowSignature = ''
    renderDay()
  } catch (error) {
    toast(`标记失败：${messageOf(error)}`)
  }
}

/** 列表当前展示的数据：检索结果或当天胶片*/
function visibleScenes(): readonly Scene[] {
  return state.search === null ? state.day.scenes : state.search.hits.map((hit) => hit.scene)
}

/** 命中理由一行：`命中 edl · 日期 11-19`；只有其中一项时只写那一项。 */

function renderList(): void {
  const outcome = state.search
  const scenes = visibleScenes()
  const shots = scenes.filter((scene) => scene.kind === 'shot').length
  const rests = scenes.length - shots
  if (outcome === null) {
    ui.listCount.textContent = rests > 0 ? `${rests} 段中场休息 · ${shots} 个镜头` : `${shots} 个镜头`
  } else {
    ui.listCount.textContent = `${scenes.length} 条${scenes.length >= SEARCH_LIMIT ? '（上限 200）' : ''}`
  }

  const last = scenes[scenes.length - 1]
  // 数据签名变短了：窗口化后只关心首尾与长度，末尾镜头的时长仍会跟着 tick 更新
  const mode = outcome === null ? 'd' : 'q'
  const signature = `${mode}|${scenes.length}|${scenes[0]?.id ?? ''}|${last?.id ?? ''}|${last?.end ?? 0}`
  if (signature !== listSignature) {
    listSignature = signature
    windowSignature = ''
  }

  ui.empty.hidden = scenes.length > 0
  ui.empty.textContent = outcome === null ? emptyCopy() : searchEmptyCopy(outcome)
  ui.searchNote.hidden = !(outcome !== null && outcome.coverage === 'partial' && scenes.length > 0)
  renderWindow()
}

/** 只把可视区加缓冲内的行渲染出来；其余行由 spacer 高度占位*/
function renderWindow(): void {
  const scenes = visibleScenes()
  const range = windowRange({
    count: scenes.length,
    rowHeight: rowStride,
    scrollTop: ui.listScroll.scrollTop,
    viewportHeight: listViewport,
    overscan: OVERSCAN
  })
  ui.spacer.style.height = `${range.totalHeight + 8}px`
  ui.list.style.transform = `translate3d(0,${range.offset}px,0)`
  const signature = `${listSignature}|${range.start}|${range.end}`
  if (signature === windowSignature) return
  windowSignature = signature

  const today = isoDate(Date.now())
  const withDate = state.search !== null
  const rows: HTMLLIElement[] = []
  for (let index = range.start; index < range.end; index += 1) {
    const hit = state.search?.hits[index]
    const scene = hit?.scene ?? scenes[index]
    rows.push(
      buildRow(scene, withDate && isoDate(scene.start) !== today, index, scenes.length, hit?.reason)
    )
  }
  ui.list.replaceChildren(...rows)
  highlight()
  // 数据变少后不要停在越界的滚动位置
  const maxScroll = Math.max(0, ui.spacer.offsetHeight - ui.listScroll.clientHeight)
  if (ui.listScroll.scrollTop > maxScroll) ui.listScroll.scrollTop = maxScroll
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

/** 把时刻写成 HH:MM:SS，右栏放映时间码用。 */
function wallClock(ts: number): string {
  const date = new Date(ts)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

/** 把播放头写到 hero（剧照/当前窗口/当前镜头）与右栏（时间码/进度条）。 */
function updateTransport(): void {
  const scene = sceneAt(state.playhead, state.day.scenes)
  const intermission = scene?.kind === 'intermission'
  const key = scene
    ? `${scene.id}|${dayOrdinals().size}`
    : `gap:${state.day.scenes.length}:${state.day.scenes.find((item) => item.start > state.playhead)?.id ?? 'end'}`

  if (key !== frameKey) {
    frameKey = key
    const stillUrl =
      scene && !intermission
        ? stillDataUrl(
            { exe: scene.exe, title: scene.title, kind: scene.kind },
            dayOrdinals().get(scene.id) ?? 0,
            isoDate(scene.start),
            720,
            280
          )
        : ''
    ui.heroStill.style.backgroundImage = stillUrl.length > 0 ? `url("${stillUrl}")` : ''
    if (scene && !intermission) {
      ui.heroFrame.dataset.kind = 'shot'
      ui.heroFrameTag.hidden = true
      ui.heroFrameEmpty.hidden = true
    } else {
      ui.heroFrame.dataset.kind = intermission ? 'intermission' : 'empty'
      ui.heroFrameTag.hidden = !intermission
      ui.heroFrameTag.textContent = intermission ? '中场休息' : ''
      const next = state.day.scenes.find((item) => item.start > state.playhead)
      ui.heroFrameEmpty.hidden = intermission
      if (state.day.scenes.length === 0) {
        ui.heroFrameEmptyTitle.textContent = '摄影机还没开'
        ui.heroFrameEmptyText.textContent = 'Dayfilm 在后台记录，第一个镜头出现后会出现在这里'
      } else {
        let emptyText = '摄影机未运行 · 这一天的胶片到此结束'
        if (next) emptyText = `摄影机未运行 · 下一镜 ${fmtClock(next.start)}`
        ui.heroFrameEmptyTitle.textContent = '空档'
        ui.heroFrameEmptyText.textContent = emptyText
      }
    }
  }

  // 当前窗口：拍摄中显示进程 — 标题，空档写明
  if (scene) {
    ui.liveExe.textContent = intermission ? '中场休息' : scene.exe || '—'
    ui.liveTitle.textContent = intermission ? '' : scene.title
  } else {
    const next = state.day.scenes.find((item) => item.start > state.playhead)
    ui.liveExe.textContent = state.day.scenes.length === 0 ? '—' : '空档'
    let gapText = '这一天的胶片到此结束'
    if (state.day.scenes.length === 0) gapText = emptyCopy()
    else if (next) gapText = `没有采样 · 下一镜 ${fmtClock(next.start)}`
    ui.liveTitle.textContent = gapText
  }

  // 当前镜头时长 / 项目标签
  ui.metricShot.textContent = scene ? fmtElapsed(scene.seconds * 1000) : '—'
  const project =
    scene && scene.kind === 'shot' ? matchProject(scene, state.settings.projects) : null
  if (project !== null) {
    ui.metricProject.textContent = project
    ui.metricProject.removeAttribute('title')
  } else if (state.settings.projects.length === 0) {
    ui.metricProject.textContent = '未设置'
    ui.metricProject.title = '在设置里加一条项目规则，镜头会自动归到项目'
  } else {
    ui.metricProject.textContent = '未匹配'
    ui.metricProject.title = '这一镜没有命中任何项目规则'
  }

  // 进度条只跨素材区间，时间码仍显示真实时刻
  const material = playbackRange(state.day.scenes)
  const min = material ? Math.max(0, Math.floor((material.start - dayStart()) / 60_000)) : 0
  const max = material ? Math.max(min + 1, Math.ceil((material.end - dayStart()) / 60_000)) : 1440
  if (ui.scrub.min !== String(min)) ui.scrub.min = String(min)
  if (ui.scrub.max !== String(max)) ui.scrub.max = String(max)
  const minuteValue = Math.round((state.playhead - dayStart()) / 60_000)
  const minutes = String(minuteValue)
  if (ui.scrub.value !== minutes) ui.scrub.value = minutes
  const played = max > min ? Math.min(1, Math.max(0, (minuteValue - min) / (max - min))) : 0
  ui.scrub.style.setProperty('--played', `${(played * 100).toFixed(1)}%`)

  const code = wallClock(state.playhead)
  if (code !== timecodeKey) {
    timecodeKey = code
    ui.timecode.textContent = code
  }
}

function renderDay(): void {
  renderHero()
  renderStats()
  renderHighlights()
  renderDiscoveries()
  renderList()
  highlight()
  updateTransport()
  paintSpineCanvas()
}

/* 剪辑发现（v3） ------------------------------------------------------ */

/** hero 里原有发现最多三行，最后固定追加一行「镜头之后」，总共最多四条。 */
function renderDiscoveries(): void {
  const found = state.mode === 'day' ? findDiscoveries(state.day, state.settings.projects) : []
  const after = state.mode === 'day' ? afterLongestShot(state.day) : null
  const rows = buildDiscoveryRows(document, found, after, discoveryDeps())
  ui.discoveries.hidden = rows === null
  ui.discoveries.replaceChildren(...(rows ?? []))
}

/** 发现区的公共行为：证据时刻 → 选中镜头（切日与滚动复用现有逻辑）。 */
function discoveryDeps(): RowDeps {
  return {
    clock: fmtClock,
    onPick: (startMs: number) => {
      const scene = state.day.scenes.find((entry) => entry.kind === 'shot' && entry.start >= startMs)
      if (!scene) return
      selectScene(scene)
      revealRow(scene.id, 'center')
    }
  }
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

/** 主按钮只有播放/暂停两个面，用符号保持 40×40 的方形。 */
function setPlayButton(playing: boolean): void {
  state.playing = playing
  ui.playBtn.textContent = playing ? '❚❚' : '▶'
  ui.playBtn.dataset.state = playing ? 'playing' : 'paused'
  ui.playBtn.setAttribute('aria-label', playing ? '暂停' : '播放')
}

function pause(): void {
  if (projection.active) {
    stopProjection()
    return
  }
  setPlayButton(false)
}

/* 放映：进入后才算“播放”，胶片收细、中央放大画---------------------------------- */

function currentProjectionScene(): Scene | null {
  return sceneAt(projection.filmMs, state.day.scenes)
}

/** 放映画面上的镜次：取该时刻之前最后一个镜头的序号。 */
function shotOrdinalFor(ts: number): number {
  const ordinals = dayOrdinals()
  let ordinal = 1
  for (const scene of state.day.scenes) {
    if (scene.kind !== 'shot') continue
    if (scene.start > ts) break
    ordinal = ordinals.get(scene.id) ?? ordinal
  }
  return ordinal
}

/** 当天最长镜头的秒数：时长尺的分母。 */
function longestShotSeconds(): number {
  let longest = 0
  for (const scene of state.day.scenes) {
    if (scene.kind === 'shot') longest = Math.max(longest, scene.seconds)
  }
  return Math.max(1, longest)
}

/* 片头卡 --------------------------------------------------------------- */

const titleCardSeen = new Set<string>()
let titleCardTimer = 0
let titleCardSwallow: ((event: KeyboardEvent) => void) | null = null

function dismissTitleCard(): void {
  if (ui.titleCard.hidden) return
  window.clearTimeout(titleCardTimer)
  ui.titleCard.hidden = true
  ui.titleCard.classList.remove('is-playing')
  if (titleCardSwallow) {
    window.removeEventListener('keydown', titleCardSwallow, true)
    titleCardSwallow = null
  }
}

/** 进入有镜头的一天时播一次；同一天只播一次，Esc 跳过。 */
function playTitleCard(): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const hasShots = state.day.scenes.some((scene) => scene.kind === 'shot')
  if (!hasShots || !shouldPlayTitleCard(titleCardSeen, state.date, reduced)) return
  titleCardSeen.add(state.date)
  // 上一张还在播时先收掉，避免两个定时器打架
  dismissTitleCard()
  ui.titleCardDate.textContent = fmtDateLabel(state.date, isoDate(Date.now()))
  ui.titleCardVerdict.textContent = state.day.verdict.label
  ui.titleCard.hidden = false
  void ui.titleCard.offsetWidth
  ui.titleCard.classList.add('is-playing')
  titleCardSwallow = (event: KeyboardEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') dismissTitleCard()
  }
  window.addEventListener('keydown', titleCardSwallow, true)
  titleCardTimer = window.setTimeout(dismissTitleCard, TITLE_CARD_MS)
}

function paintProjectionFrame(animate: boolean): void {
  const canvas = ui.projectionFrame
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const ctx = sizeCanvas(canvas, rect.width, rect.height)
  if (!ctx) return
  const scene = currentProjectionScene()
  // 帧内镜次与说明行用同一个序号：空隙/中场休息时指向刚结束的那一镜
  const ordinal = shotOrdinalFor(projection.filmMs)
  if (scene) {
    const intermission = scene.kind === 'intermission'
    paintProjectionBoard(
      ctx,
      projectionFrameParams({
        date: state.date,
        shot: ordinal,
        total: projection.total,
        exe: intermission ? '中场休息' : scene.exe,
        title: intermission ? '中场休息' : scene.title,
        hue: exeHue(scene.exe.length > 0 ? scene.exe : '中场休息'),
        showBar: !intermission,
        start: scene.start,
        end: scene.end,
        seconds: scene.seconds,
        maxSeconds: longestShotSeconds(),
        grainSeed: hashString(scene.id),
        width: rect.width,
        height: rect.height
      })
    )
  } else {
    const next = state.day.scenes.find((item) => item.start > projection.filmMs)
    paintProjectionGap(
      ctx,
      rect.width,
      rect.height,
      next
        ? `摄影机未运行 · 下一镜 ${fmtClock(next.start)}`
        : '摄影机未运行 · 这一天的胶片到此结束'
    )
  }
  if (animate) {
    ui.projectionStage.classList.remove('is-cutting')
    void ui.projectionStage.offsetWidth
    ui.projectionStage.classList.add('is-cutting')
    window.setTimeout(() => ui.projectionStage.classList.remove('is-cutting'), 160)
  }
  const intermission = scene?.kind === 'intermission'
  const total = Math.max(1, projection.total)
  ui.projectionIndex.textContent = `#${String(ordinal).padStart(2, '0')}`
  ui.projectionTitle.textContent = intermission ? '中场休息' : (scene?.title ?? '空档')
  ui.shotCounter.textContent = `SHOT ${String(Math.min(total, Math.max(1, ordinal))).padStart(2, '0')} / ${String(total).padStart(2, '0')}`
  updateSubtitle(scene ? pickNarration(state.day, scene, ordinal) : null)
}

let subtitleKey = ''

/** 字幕只在镜头变化时更新，避免每帧重建文本节点。 */
function updateSubtitle(narration: Narration | null): void {
  const key = narration ? `${narration.index}:${narration.text}` : ''
  if (key === subtitleKey) return
  subtitleKey = key
  if (!narration) {
    ui.projectionSubtitle.hidden = true
    return
  }
  ui.projectionSubtitle.hidden = false
  ui.projectionSubtitleIndex.textContent = `第 ${narration.index} 镜`
  ui.projectionSubtitleText.textContent = narration.text
}

function paintProjectionStrip(): void {
  const canvas = ui.projectionStripCanvas
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const ctx = sizeCanvas(canvas, rect.width, rect.height)
  if (!ctx) return
  ctx.clearRect(0, 0, rect.width, rect.height)
  const bounds = filmBounds(state.day.scenes)
  if (!bounds) return
  const span = bounds.end - bounds.start
  for (const scene of state.day.scenes) {
    if (scene.kind !== 'shot') continue
    const x = ((scene.start - bounds.start) / span) * rect.width
    const w = Math.max(1, ((scene.end - scene.start) / span) * rect.width)
    const played = scene.end <= projection.filmMs
    ctx.fillStyle = familyColor(exeHue(scene.exe), played ? 0.85 : 0.2)
    ctx.fillRect(x, 0, w, rect.height)
  }
}

function updateProjectionChrome(): void {
  const bounds = filmBounds(state.day.scenes)
  if (bounds) {
    const ratio = (projection.filmMs - bounds.start) / Math.max(1, bounds.end - bounds.start)
    const width = ui.projectionStrip.clientWidth
    ui.projectionHead.style.transform = `translateX(${Math.round(Math.min(1, Math.max(0, ratio)) * width)}px)`
  }
  ui.projectionClock.textContent = fmtClock(projection.filmMs)
  const rate = showCutRate(projection.speed) ? `每秒 ${cutsPerSecond(projection).toFixed(1)} 次剪辑` : ''
  if (rate !== projectionCutsText) {
    projectionCutsText = rate
    ui.projectionCuts.textContent = rate
    ui.projectionCuts.hidden = rate.length === 0
  }
}

function onProjectionCut(): void {
  paintProjectionFrame(true)
  paintProjectionStrip()
  ui.projectionStage.classList.remove('is-cut')
  void ui.projectionStage.offsetWidth
  ui.projectionStage.classList.add('is-cut')
  window.setTimeout(() => ui.projectionStage.classList.remove('is-cut'), 90)
  projectorAudio.click()
}

/** 放映音效电平：3 格电平条 + <html data-audio-level>（100ms 一刷）。 */
let audioMeterTimer = 0

function paintAudioMeter(level: number): void {
  const thresholds = [0.08, 0.35, 0.65]
  const bars = [...ui.audioMeter.children]
  bars.forEach((bar, index) => {
    bar.classList.toggle('is-on', level > (thresholds[index] ?? 1))
  })
}

function startAudioMeter(): void {
  window.clearInterval(audioMeterTimer)
  audioMeterTimer = window.setInterval(() => {
    const level = projectorAudio.level()
    document.documentElement.dataset.audioLevel = level.toFixed(2)
    paintAudioMeter(level)
  }, 100)
}

function stopAudioMeter(): void {
  window.clearInterval(audioMeterTimer)
  audioMeterTimer = 0
  document.documentElement.dataset.audioLevel = '0.00'
  paintAudioMeter(0)
}

function startProjection(): void {
  const selected = state.selectedId
    ? (state.day.scenes.find((scene) => scene.id === state.selectedId) ?? null)
    : null
  const from = playbackStart(selected, state.day.scenes)
  if (from === null) {
    toast('这一天没有素材，无法放映')
    announce('这一天没有素材，无法放映')
    return
  }
  projection = enterProjection(from, state.day.scenes, { speed: state.speed, sound: projection.sound })
  if (projection.total === 0) return
  state.playing = true
  ui.playBtn.textContent = '暂停'
  ui.playBtn.dataset.state = 'playing'
  ui.projection.hidden = false
  ui.soundToggle.textContent = projection.sound ? '声音：开' : '声音：关'
  ui.soundToggle.setAttribute('aria-pressed', String(projection.sound))
  projectorAudio.setVolume(state.settings.sound.volume)
  projectorAudio.setMode(state.settings.sound.mode)
  projectorAudio.setEnabled(projection.sound)
  if (projection.sound) startAudioMeter()
  else stopAudioMeter()
  paintProjectionFrame(false)
  paintProjectionStrip()
  updateProjectionChrome()
  projectionLast = performance.now()
  projectionRaf = requestAnimationFrame(projectionStep)
  // 遮罩刚显示时量不到尺寸，下一帧补一
requestAnimationFrame(() => {
    if (!projection.active) return
    paintProjectionFrame(false)
    paintProjectionStrip()
    updateProjectionChrome()
  })
}

function stopProjection(): void {
  if (!projection.active) return
  const endedAt = projection.filmMs
  projection = exitProjection(projection)
  cancelAnimationFrame(projectionRaf)
  projectorAudio.dispose()
  stopAudioMeter()
  ui.projection.hidden = true
  state.playing = false
  setPlayButton(false)
  state.playhead = Math.min(dayEnd(), Math.max(dayStart(), endedAt))
  updateTransport()
  paintSpineCanvas()
}

function projectionStep(now: number): void {
  if (!projection.active) return
  const delta = Math.min(120, Math.max(0, now - projectionLast))
  projectionLast = now
  const before = projection.shot
  projection = advanceProjection(projection, delta, state.day.scenes)
  if (projection.shot !== before) onProjectionCut()
  updateProjectionChrome()
  const material = playbackRange(state.day.scenes)
  if (projectionFinished(projection, state.day.scenes) || (material !== null && projection.filmMs >= material.end)) {
    stopProjection()
    return
  }
  projectionRaf = requestAnimationFrame(projectionStep)
}

function togglePlay(): void {
  if (projection.active) stopProjection()
  else startProjection()
}

function seek(ts: number): void {
  state.playhead = Math.min(dayEnd(), Math.max(dayStart(), ts))
  updateTransport()
  paintSpineCanvas()
}

function announceScene(prefix: string, scene: Scene): void {
  const who = scene.kind === 'intermission' ? '中场休息' : `${scene.exe}，${scene.title}`
  announce(`${prefix}：${fmtClock(scene.start)}–${fmtClock(scene.end)}，${who}，${fmtDuration(scene.seconds)}`)
}

function selectScene(scene: Scene): void {
  state.selectedId = scene.id
  pause()
  state.playhead = Math.min(dayEnd(), Math.max(dayStart(), scene.start))
  revealSpine(scene.start)
  highlight()
  updateTransport()
  paintSpineCanvas()
  announceScene('已选镜头', scene)
}

function openDetail(scene: Scene): void {
  const row = revealRow(scene.id, 'center')
  row?.focus({ preventScroll: true })
  announceScene('镜头详情', scene)
}

/** 镜头表键盘导航：↑↓ 选镜头，Enter 聚焦选中行。 */
function onListKey(event: KeyboardEvent): void {
  const scenes = state.day.scenes
  if (scenes.length === 0) return
  const index = scenes.findIndex((scene) => scene.id === state.selectedId)
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const step = event.key === 'ArrowDown' ? 1 : -1
    const next = index < 0 ? 0 : Math.min(scenes.length - 1, Math.max(0, index + step))
    selectScene(scenes[next])
    revealRow(scenes[next].id, 'nearest')
    return
  }
  if (event.key === 'Enter' && index >= 0) {
    event.preventDefault()
    openDetail(scenes[index])
  }
}

async function locate(scene: Scene): Promise<void> {
  const date = isoDate(scene.start)
  if (date !== state.date) await loadDate(date)
  const target = state.day.scenes.find((item) => item.id === scene.id)
  if (target) selectScene(target)
  revealRow(scene.id, 'nearest')
}

/** 换日期或换检索结果时回到列表顶部，否则会停在上一份数据的位置*/
function resetListScroll(): void {
  ui.listScroll.scrollTop = 0
  listSignature = ''
  windowSignature = ''
}

async function loadDate(date: string): Promise<void> {
  if (projection.active) stopProjection()
  state.date = date
  // 主动翻到非今= 浏览历史，跨零点也不再拉回视
state.browsingHistory = date !== isoDate(Date.now())
  // 下拉框的选项里永远包含当前日期：没有日文件的天也能选中并显
renderDates()
  state.day = await state.source.getDay(date)
  state.selectedId = null
  pause()
  state.playhead = initialPlayhead()
  resetListScroll()
  frameKey = ''
  timecodeKey = ''
  // 手记先清空再载入，不能把上一天的内容留在框里
  window.clearTimeout(noteTimer)
  state.note = ''
  state.noteSaved = ''
  ui.note.value = ''
  updateNoteMeta()
  setNoteStatus('idle', '')
  renderDay()
  ui.spineScroll.scrollTop = 0
  revealSpine(state.playhead)
  paintSpineCanvas()
  void loadNote(date)
  void loadEpisode()
  if (state.mode === 'day') playTitleCard()
}

/** 空状态的文案：今天还没素材和历史某天没采样是两件事*/
function emptyCopy(): string {
  return isToday() ? '还没有拍摄任何素材' : '这一天没有采样'
}

/** 检索空状态的两种文案：日期超出保留范围 vs 普通没有命中。 */

/* 上一集（v4 S4） ---------------------------------------------------- */

let episodeRef: EpisodeRef | null = null
/** 请求令牌：快速切日时丢弃晚到的旧响应 */
const episodeRequests = createRequestToken()

async function loadEpisode(): Promise<void> {
  const token = episodeRequests.next()
  const date = state.date
  try {
    const ref = await state.source.previousEpisode(date)
    if (!episodeRequests.isCurrent(token)) return
    episodeRef = ref
  } catch {
    if (!episodeRequests.isCurrent(token)) return
    episodeRef = null
  }
  renderEpisode()
}

function renderEpisode(): void {
  const ref = episodeRef
  ui.episode.hidden = ref === null
  ui.episode.textContent = ref === null ? '' : episodeText(ref, fmtClock)
}

/** 整行可点：切到那一天并选中那个镜头（复用现有切日 / 选镜头逻辑）。 */
async function gotoEpisode(ref: EpisodeRef): Promise<void> {
  if (state.date !== ref.date) await loadDate(ref.date)
  const scene = state.day.scenes.find((item) => item.start === ref.start)
  if (scene) selectScene(scene)
}

function setSpeed(speed: Speed): void {
  state.speed = speed
  // 放映中也跟着换倍速，不用退出再
if (projection.active) projection = setProjectionSpeed(projection, speed)
  for (const button of ui.speedBtns) {
    const active = Number(button.dataset.speed) === speed
    button.classList.toggle('is-active', active)
    button.setAttribute('aria-pressed', String(active))
  }
}

async function exportDay(): Promise<void> {
  try {
    const path = await state.source.exportScreenplay(state.date)
    toast(`剧本已导出：${path}`)
  } catch (error) {
    toast(`导出失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function runSearch(): Promise<void> {
  const query = ui.search.value.trim()
  if (query.length === 0) {
    state.search = null
    resetListScroll()
    renderList()
    highlight()
    return
  }
  const outcome = await state.source.search(query)
  if (query !== ui.search.value.trim()) return
  state.search = { ...outcome, hits: outcome.hits.slice(0, SEARCH_LIMIT) }
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
  }
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
  renderStats()
  // 项目标签依赖规则，列表要整份重算
  listSignature = ''
  windowSignature = ''
  renderList()
  refreshWeekIfVisible()
  void loadEpisode()
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

/** 内置脱敏词是合同里给的常量，这里只渲染一次 */
function renderSettingsStatic(): void {
  ui.builtinCount.textContent = String(BUILTIN_REDACT_TERMS.length)
  ui.builtinTerms.textContent = BUILTIN_REDACT_TERMS.join(' · ')
}

function renderSettings(): void {
  const settings = state.settings
  retentionSelect?.setValue(String(settings.retentionDays))
  autoExtraSelect?.setValue(String(settings.autoExtraUnderSec))
  const mode = settings.sound?.mode ?? 'projector'
  ui.soundModeProjector.classList.toggle('is-active', mode === 'projector')
  ui.soundModeProjector.setAttribute('aria-pressed', String(mode === 'projector'))
  ui.soundModeCuts.classList.toggle('is-active', mode === 'cuts')
  ui.soundModeCuts.setAttribute('aria-pressed', String(mode === 'cuts'))
  const volume = Math.round((settings.sound?.volume ?? 0.35) * 100)
  if (ui.soundVolume.value !== String(volume)) ui.soundVolume.value = String(volume)
  ui.soundVolumeValue.textContent = String(volume)
  ui.autoStart.checked = settings.autoStart
  ui.pausedToggle.checked = settings.paused
  ui.hudToggle.checked = settings.hud.visible
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
  renderAiSettings()
  renderSettingsSection()
  // 导航上只写数量：有几条项目，扫一眼就知道状态
  ui.navCountProjects.textContent = settings.projects.length > 0 ? String(settings.projects.length) : ''
}

/** 分区导航：抽屉只展示一个分区，结构本身说明有哪些设置。 */
function renderSettingsSection(): void {
  for (const item of ui.settingsNav.querySelectorAll<HTMLButtonElement>('.nav-item')) {
    const active = item.dataset.section === state.settingsSection
    item.classList.toggle('is-active', active)
    if (active) item.setAttribute('aria-current', 'true')
    else item.removeAttribute('aria-current')
  }
  for (const pane of ui.settingsPane.querySelectorAll<HTMLElement>('[data-pane]')) {
    pane.hidden = pane.dataset.pane !== state.settingsSection
  }
}

async function loadSettings(): Promise<void> {
  if (state.settingsReady) return
  setPanelStatus('正在读取设置…', 'idle')
  try {
    state.settings = await state.source.getSettings()
    state.settingsReady = true
    renderSettings()
    // 项目规则影响汇总与列表标签，读回来就要重算
    renderStats()
    listSignature = ''
    windowSignature = ''
    renderList()
    refreshWeekIfVisible()
    void loadEpisode()
    setPanelStatus('', 'idle')
  } catch (error) {
    setPanelStatus(`读取设置失败：${messageOf(error)}`, 'error')
  }
}

/** 提交设置。失败时回到提交前的值并报错，不假装保存成功*/
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
      renderStats()
      renderList()
      refreshWeekIfVisible()
    }
    // 上一集看项目规则：设置一变就重查，但不跟 2 秒 tick 刷新
    void loadEpisode()
    return true
  } catch (error) {
    state.settings = before
    renderSettings()
    setPanelStatus(`保存失败：${messageOf(error)}`, 'error')
    return false
  }
}

/** 可Tab到达的元素（浮层内焦点不跑到背景页面）。 */
function focusables(root: HTMLElement): HTMLElement[] {
  const selector =
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  return [...root.querySelectorAll<HTMLElement>(selector)].filter((element) => element.offsetParent !== null)
}

/** Tab / Shift+Tab 在 root 内循环。 */
function trapTab(event: KeyboardEvent, root: HTMLElement): void {
  if (event.key !== 'Tab') return
  const items = focusables(root)
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

function openPanel(): void {
  if (state.panelOpen) return
  state.panelOpen = true
  ui.drawer.hidden = false
  ui.settingsBtn.setAttribute('aria-expanded', 'true')
  renderSettings()
  retentionSelect?.focus()
  void loadSettings()
}

function closePanel(): void {
  if (!state.panelOpen) return
  state.panelOpen = false
  ui.drawer.hidden = true
  ui.settingsBtn.setAttribute('aria-expanded', 'false')
  setPanelStatus('', 'idle')
  // 触发按钮只有一个：关闭后把焦点固定还给
ui.settingsBtn.focus({ preventScroll: true })
}

/** Esc 关闭；Tab 在面板内循环，不跑到背后的界面上*/
function onPanelKey(event: KeyboardEvent): void {
  if (!state.panelOpen) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closePanel()
    return
  }
  trapTab(event, ui.panel)
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

function setInputError(
  input: HTMLInputElement | HTMLTextAreaElement,
  message: string | null
): void {
  input.classList.toggle('input--error', message !== null)
  if (message === null) input.removeAttribute('aria-invalid')
  else input.setAttribute('aria-invalid', 'true')
}

async function addTerm(): Promise<void> {
  const term = ui.termInput.value.trim()
  if (term.length === 0) {
    setInputError(ui.termInput, '请输入关键词')
    setPanelStatus('关键词不能为空', 'error')
    return
  }
  if (state.settings.redactTerms.includes(term)) {
    setInputError(ui.termInput, '关键词重复')
    setPanelStatus('这个关键词已经在列表里', 'error')
    return
  }
  setInputError(ui.termInput, null)
  const saved = await applySettings({ redactTerms: [...state.settings.redactTerms, term] })
  if (saved) ui.termInput.value = ''
}

function removeTerm(term: string): void {
  void applySettings({ redactTerms: state.settings.redactTerms.filter((item) => item !== term) })
}

/** 滚动只在下一帧重算可见区间，不在滚动事件里同步读写布局*/
function onListScroll(): void {
  if (scrollRaf !== 0) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    renderWindow()
  })
}

/* 周模式：日视图与周电影互斥 --------------------------------------- */

/** 换到某一天：退出检索、回到列表顶部、重置视窗*/
async function selectDay(date: string): Promise<void> {
  ui.search.value = ''
  state.search = null
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

/** 停止输入 600ms 后自动保存；失败时保留编辑内容并报错*/
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
  // hidden 与子节点永远一致：要么三张卡片可见，要么整块隐藏且没有子节
if (cards.length === 0) {
    ui.highlights.replaceChildren()
    ui.highlights.hidden = true
    return
  }
  ui.highlights.replaceChildren(...cards)
  ui.highlights.hidden = false
}

/* 海报 --------------------------------------------------------------- */

async function exportPoster(theme: PosterTheme): Promise<void> {
  if (state.day.scenes.length === 0) {
    toast('当天还没有素材，无法导出海报')
    return
  }
  try {
    const layout = computePoster({
      day: state.day,
      projects: state.settings.projects,
      note: state.note,
      theme
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
  }
}

async function exportEdlNow(): Promise<void> {
  if (state.day.scenes.length === 0) {
    toast('当天还没有素材，无法导出 EDL')
    return
  }
  ui.exportEdlBtn.disabled = true
  try {
    const path = await state.source.exportEdl(state.date)
    toast(path.length > 0 ? `EDL 已导出：${path}` : '已取消导出 EDL')
  } catch (error) {
    toast(`EDL 导出失败：${messageOf(error)}`)
  } finally {
    ui.exportEdlBtn.disabled = false
  }
}

/* 剧本 PDF（R53） -------------------------------------------------------*/

async function exportPdfNow(): Promise<void> {
  if (state.day.scenes.length === 0) {
    toast('当天还没有素材，无法导出 PDF')
    return
  }
  ui.exportPdfBtn.disabled = true
  try {
    const { path } = await state.source.exportPdf(state.date)
    if (path.length > 0) toast(`PDF 已导出：${path}`)
    else if (state.source.mode === 'mock') toast('演示环境不支持导出 PDF')
    else toast('已取消导出 PDF')
  } catch (error) {
    toast(`PDF 导出失败：${messageOf(error)}`)
  } finally {
    ui.exportPdfBtn.disabled = false
  }
}

/* 顶栏菜单：导出 / 更多 -----------------------------------------------*/

let openMenuPanel: HTMLElement | null = null
let openMenuAnchor: HTMLButtonElement | null = null

function closeMenus(): void {
  if (openMenuPanel === null) return
  openMenuPanel.hidden = true
  openMenuAnchor?.setAttribute('aria-expanded', 'false')
  openMenuPanel = null
  openMenuAnchor = null
}

function showMenu(panel: HTMLElement, anchor: HTMLButtonElement): void {
  closeMenus()
  panel.hidden = false
  anchor.setAttribute('aria-expanded', 'true')
  const rect = anchor.getBoundingClientRect()
  const width = panel.offsetWidth
  panel.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width))}px`
  panel.style.top = `${rect.bottom + 6}px`
  panel.querySelector<HTMLElement>('.menu__item')?.focus()
  openMenuPanel = panel
  openMenuAnchor = anchor
}

function toggleMenu(panel: HTMLElement, anchor: HTMLButtonElement): void {
  if (openMenuPanel === panel) closeMenus()
  else showMenu(panel, anchor)
}

/** 菜单内键盘：Esc 关闭、↑↓ 在项目之间移焦点。 */
function onMenuKey(event: KeyboardEvent): void {
  if (openMenuPanel === null) return
  if (event.key === 'Escape') {
    event.preventDefault()
    const anchor = openMenuAnchor
    closeMenus()
    anchor?.focus({ preventScroll: true })
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const items = [...openMenuPanel.querySelectorAll<HTMLElement>('.menu__item')]
  if (items.length === 0) return
  event.preventDefault()
  const index = items.indexOf(document.activeElement as HTMLElement)
  const step = event.key === 'ArrowDown' ? 1 : -1
  items[(index + step + items.length) % items.length]?.focus()
}

/* 放映音效（v2.6）----------------------------------------------------*/

/** 调试音量/模式：立即同步到 WebAudio，再落盘设置。 */
async function applySound(patch: Partial<Settings['sound']>): Promise<void> {
  const next = { ...state.settings.sound, ...patch }
  projectorAudio.setVolume(next.volume)
  projectorAudio.setMode(next.mode)
  await applySettings({ sound: next })
}

/* 批量标记（v2.6）----------------------------------------------------*/

const BULK_LIMIT = 200
let clearArmedAt = 0

/** 把符合条件的镜头串行标成花絮/清除；只动已存在的镜头，不改设置。 */
async function bulkMark(kind: 'under10' | 'auto' | 'clear'): Promise<void> {
  const shots = state.day.scenes.filter((scene) => scene.kind === 'shot')
  if (shots.length === 0) {
    toast('当天没有镜头，无法批量标记')
    return
  }
  let targets: Scene[] = []
  let mark: SceneMark | null = 'extra'
  if (kind === 'clear') {
    const marked = state.day.scenes.filter((scene) => scene.mark !== undefined)
    if (marked.length === 0) {
      toast('今天还没有标记')
      return
    }
    if (Date.now() - clearArmedAt > 4000) {
      clearArmedAt = Date.now()
      toast('再点一次「清除今天的全部标记」确认（4 秒内有效）')
      return
    }
    clearArmedAt = 0
    targets = marked.slice(0, BULK_LIMIT)
    mark = null
  } else {
    const threshold = kind === 'under10' ? 10 : state.settings.autoExtraUnderSec
    if (threshold <= 0) {
      toast('自动花絮阈值为 0，先到设置里选一个阈值')
      return
    }
    targets = shots.filter((scene) => scene.seconds < threshold && scene.mark !== 'extra').slice(0, BULK_LIMIT)
    if (targets.length === 0) {
      toast(`没有需要标记的镜头（阈值 ${threshold} 秒）`)
      return
    }
  }

  let done = 0
  let latest: DayRollup | null = null
  for (const scene of targets) {
    try {
      latest = await state.source.setMark(state.date, scene.start, mark)
      done += 1
    } catch (error) {
      toast(`标记失败：${messageOf(error)}`)
      return
    }
  }
  if (latest !== null) {
    state.day = latest
    if (state.live !== null && state.live.day.date === state.date) {
      state.live = { ...state.live, day: latest }
    }
    listSignature = ''
    windowSignature = ''
    renderDay()
  }
  toast(kind === 'clear' ? `已清除 ${done} 条标记` : `已标记 ${done} 条`)
}

/** 当天没有镜头时禁用批量菜单项。 */
function renderBulkState(): void {
  const empty = !state.day.scenes.some((scene) => scene.kind === 'shot')
  ui.markUnder10.disabled = empty
  ui.markAuto.disabled = empty
  ui.markClear.disabled = empty
}

/* 双日对比（R51）--------------------------------------------------------*/

const COMPARE_LOOKBACK = 7

/** 取一天给对比用：缓存包含失败（null），不反复打主进程。 */
async function compareDay(date: string): Promise<DayRollup | null> {
  const cached = state.compareCache.get(date)
  if (cached !== undefined) return cached
  try {
    const day = await state.source.getDay(date)
    state.compareCache.set(date, day)
    return day
  } catch {
    state.compareCache.set(date, null)
    return null
  }
}

/** 默认对照：今天之前最近一个真有镜头的天；都空就退回上一天。 */
async function previousDataDate(today: string): Promise<string> {
  const candidates = state.dates
    .filter((date) => date < today)
    .sort((a, b) => a.localeCompare(b))
    .reverse()
    .slice(0, COMPARE_LOOKBACK)
  for (const date of candidates) {
    const day = await compareDay(date)
    if (day !== null && day.scenes.some((scene) => scene.kind === 'shot')) return date
  }
  return candidates[0] ?? today
}

async function openCompare(): Promise<void> {
  if (state.compareOpen) return
  state.compareOpen = true
  ui.compare.hidden = false
  const today = isoDate(Date.now())
  if (state.compareDates.left === '' || state.compareDates.right === '') {
    state.compareDates = { left: today, right: await previousDataDate(today) }
  }
  await renderCompare()
  // 浮层打开后焦点进到左侧日期，Tab 不出浮层
  ui.compareLeft.querySelector<HTMLElement>('.select__trigger')?.focus({ preventScroll: true })
}

function closeCompare(): void {
  if (!state.compareOpen) return
  state.compareOpen = false
  ui.compare.hidden = true
  ui.compareOpenBtn.focus({ preventScroll: true })
}

function compareDayNodes(side: CompareSide, date: string, which: 'left' | 'right'): HTMLElement[] {
  const today = isoDate(Date.now())
  const dates = state.dates.includes(date) ? state.dates : [date, ...state.dates]
  const select = createSelect({
    label: which === 'left' ? '左侧日期' : '右侧日期',
    className: 'select--compare',
    options: dates.map((item) => ({ value: item, label: fmtDateLabel(item, today) })),
    value: date,
    onChange: (value) => {
      state.compareDates = { ...state.compareDates, [which]: value }
      void renderCompare()
    }
  })
  select.element.dataset.side = which
  return [
    select.element,
    node(
      'span',
      side.empty ? 'compare__genre compare__genre--empty' : 'compare__genre',
      side.empty ? '没有采样' : side.genre
    )
  ]
}

/** 两卷胶片 + 一条共享的时刻刻度（两天的并集范围）。 */
function compareChartNodes(result: CompareResult): HTMLElement[] {
  const sides: [CompareSide, string, 'left' | 'right'][] = [
    [result.left, state.compareDates.left, 'left'],
    [result.right, state.compareDates.right, 'right']
  ]
  const nodes: HTMLElement[] = sides.map(([side, date, which]) => {
    const band = node('button', 'compare__band')
    band.type = 'button'
    band.dataset.date = date
    band.dataset.side = which
    band.disabled = side.empty
    band.setAttribute('aria-label', side.empty ? `${date} 没有素材` : `切到 ${date} 的日视图`)
    const bar = node('i', 'compare__band-bar')
    bar.style.background = familyColor(side.hue, 0.8)
    band.append(bar, node('canvas'))
    return band
  })

  const axis = node('div', 'compare__axis')
  const span = result.range === null ? 1 : Math.max(1, result.range.end - result.range.start)
  result.ticks.forEach((tick, index) => {
    const ratio = result.range === null ? 0 : (tick.at - result.range.start) / span
    const label = node('span', 'compare__axis-tick', tick.label)
    label.style.left = `${Math.min(100, Math.max(0, ratio * 100))}%`
    if (index === 0) label.dataset.align = 'start'
    else if (index === result.ticks.length - 1) label.dataset.align = 'end'
    axis.append(label)
  })
  nodes.push(axis)
  return nodes
}

/** 差异区：三个数字左右并列，中间用 →；标签旁注明差值相对右侧。 */
function compareDiffNodes(diff: readonly CompareDiffItem[]): HTMLElement[] {
  return diff.map((item) => {
    const row = node('div', 'compare__diff-row')
    const head = node('div', 'compare__diff-head')
    head.append(
      node('span', 'compare__diff-label', item.label),
      node('span', 'compare__diff-basis', '较右侧')
    )
    const pair = node('span', 'compare__diff-pair')
    pair.append(
      node('b', undefined, item.current),
      node('i', 'compare__diff-arrow', '→'),
      node('b', undefined, item.previous)
    )
    const delta = node('span', 'compare__diff-delta', formatDelta(item))
    delta.dataset.dir = deltaDirection(item)
    row.append(head, pair, delta)
    return row
  })
}

async function renderCompare(): Promise<void> {
  const token = ++compareRenderToken
  const { left, right } = state.compareDates
  const [leftDay, rightDay] = await Promise.all([compareDay(left), compareDay(right)])
  if (token !== compareRenderToken || !state.compareOpen) return
  compareResult = compareDays(leftDay, rightDay)
  ui.compareLeft.replaceChildren(...compareDayNodes(compareResult.left, left, 'left'))
  ui.compareRight.replaceChildren(...compareDayNodes(compareResult.right, right, 'right'))
  ui.compareChart.replaceChildren(...compareChartNodes(compareResult))
  ui.compareDiff.replaceChildren(...compareDiffNodes(compareResult.diff))
  paintCompareBands()
}

function paintCompareBands(): void {
  if (compareResult === null) return
  for (const band of ui.compareChart.querySelectorAll<HTMLElement>('.compare__band')) {
    const canvas = band.querySelector('canvas')
    if (!canvas) continue
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    const ctx = sizeCanvas(canvas, rect.width, rect.height)
    if (!ctx) continue
    const side = band.dataset.side === 'left' ? compareResult.left : compareResult.right
    paintCompareStrip(ctx, side.blocks, compareResult.range, rect.width, rect.height)
  }
}

/* 片场日历（R52）--------------------------------------------------------*/

async function openCalendar(): Promise<void> {
  if (state.calendarOpen) return
  state.calendarOpen = true
  ui.calendar.hidden = false
  renderCalendar()
  ui.calendarGrid.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true })
  const missing = calendarDates(isoDate(Date.now())).filter((date) => !state.calendarDays.has(date))
  if (missing.length > 0) void loadCalendar(missing)
}

function closeCalendar(): void {
  if (!state.calendarOpen) return
  state.calendarOpen = false
  ui.calendar.hidden = true
  ui.calendarOpenBtn.focus({ preventScroll: true })
}

/** 每批 7 个并发：已载入的格子先渲染，失败的天按“无数据”记。 */
async function loadCalendar(dates: readonly string[]): Promise<void> {
  if (state.calendarLoading) return
  state.calendarLoading = true
  try {
    for (let start = 0; start < dates.length; start += 7) {
      const batch = dates.slice(start, start + 7)
      await Promise.all(
        batch.map(async (date) => {
          try {
            const day = await state.source.getDay(date)
            const shots = day.scenes.filter((scene) => scene.kind === 'shot').length
            state.calendarDays.set(date, {
              date,
              activeMs: day.activeMs,
              genre: shots > 0 ? day.verdict.label : '',
              shots
            })
          } catch {
            state.calendarDays.set(date, { date, activeMs: 0, genre: '', shots: 0 })
          }
        })
      )
      renderCalendar()
    }
  } finally {
    state.calendarLoading = false
    renderCalendar()
  }
}

function calendarCellNode(cell: CalendarCell, today: string, column: number): HTMLButtonElement {
  const button = node('button', 'calendar__cell')
  button.type = 'button'
  button.dataset.date = cell.date
  button.dataset.shots = String(cell.shots > 0)
  // 列 = 周（标签列之后），行 = 周一→周日
  button.style.gridColumn = String(column + 2)
  button.style.gridRow = String(cell.dow + 2)
  if (cell.date === today) button.classList.add('is-today')
  if (cell.date === state.date) button.classList.add('is-active')
  // 题材色相 + 活跃度亮度（无记录 0/0/8%）；未来格不填色
  if (!cell.future) {
    button.style.background = `hsl(${cell.hue} ${cell.sat}% ${cell.lum}%)`
  }
  if (cell.future) {
    button.disabled = true
    button.dataset.future = 'true'
    button.setAttribute('aria-label', `${cell.date} 未到`)
    return button
  }
  const meta =
    cell.activeMs > 0
      ? `活跃 ${fmtMinutes(cell.activeMs)}${cell.genre.length > 0 ? ` · ${cell.genre}` : ''}`
      : '无记录'
  button.title = `${cell.date} · ${meta}`
  button.setAttribute('aria-label', `${cell.date} · ${meta}`)
  return button
}

const CALENDAR_ROW_LABELS = ['周一', '周三', '周五'] as const

/** B 块图例：题材类型与色相。 */
const CALENDAR_LEGEND: readonly { genre: string; text: string }[] = [
  { genre: '', text: '无记录 · H—S0% B8%' },
  { genre: '长镜头', text: '长镜头 · H200 S35 B55' },
  { genre: '标准剪辑', text: '标准剪辑 · H45 S8 B58' },
  { genre: '快切', text: '快切 · H48 S38 B68' },
  { genre: '跳切风暴', text: '跳切风暴 · H30 S62 B82' }
]

function calendarLegendNodes(): HTMLElement[] {
  return CALENDAR_LEGEND.map((item) => {
    const row = node('div', 'calendar__legend-row')
    const swatch = node('i', 'calendar__legend-swatch')
    const palette = cellPalette(item.genre, 0.5)
    swatch.style.background = `hsl(${palette.hue} ${palette.sat}% ${palette.lum}%)`
    row.append(swatch, node('span', 'calendar__legend-text', item.text))
    return row
  })
}

/** 左侧行标签 + 顶部每 4 列一个月份（相邻重复的月份不重复写）。 */
function calendarLabels(cells: readonly CalendarCell[]): HTMLElement[] {
  const labels: HTMLElement[] = []
  let previous = ''
  for (let column = 0; column < 12; column += 4) {
    const date = cells[column * 7]?.date
    if (date === undefined) continue
    const month = `${new Date(startOfDay(date)).getMonth() + 1}月`
    if (month === previous) continue
    previous = month
    const label = node('span', 'calendar__month', month)
    label.style.gridColumn = `${column + 2} / span 4`
    label.style.gridRow = '1'
    labels.push(label)
  }
  CALENDAR_ROW_LABELS.forEach((text, index) => {
    const label = node('span', 'calendar__row-label', text)
    label.style.gridColumn = '1'
    label.style.gridRow = String(index * 2 + 2)
    labels.push(label)
  })
  return labels
}

function renderCalendar(): void {
  const today = isoDate(Date.now())
  const loaded = calendarDates(today).filter((date) => state.calendarDays.has(date)).length
  ui.calendarProgress.textContent =
    loaded < CALENDAR_DAYS ? `已载入 ${loaded}/${CALENDAR_DAYS}` : ''
  if (!state.calendarOpen) return
  // 分批载入会整格重画：把焦点落回同一个日期，键盘不会丢位置
  const active = document.activeElement
  const focusedDate =
    active instanceof HTMLElement
      ? active.closest<HTMLElement>('.calendar__cell')?.dataset.date
      : undefined
  const cells = calendarCells(state.calendarDays, today)
  ui.calendarGrid.replaceChildren(
    ...calendarLabels(cells),
    ...cells.map((cell, index) => calendarCellNode(cell, today, Math.floor(index / 7)))
  )
  ui.calendarLegend.replaceChildren(
    node('p', 'calendar__legend-title', '题材色相'),
    ...calendarLegendNodes()
  )
  if (focusedDate !== undefined) {
    ui.calendarGrid.querySelector<HTMLElement>(`[data-date="${focusedDate}"]`)?.focus({ preventScroll: true })
  }
}

/** HUD 显隐走单独的通道（setHud），失败时把开关拨回去。 */
async function applyHudVisible(visible: boolean): Promise<void> {
  try {
    const next = await state.source.setHud(visible)
    state.settings = { ...state.settings, hud: { ...state.settings.hud, visible: next } }
    ui.hudToggle.checked = next
    setPanelStatus('已保存', 'ok')
  } catch (error) {
    ui.hudToggle.checked = !visible
    setPanelStatus(`保存失败：${messageOf(error)}`, 'error')
  }
}

/* 项目规则（设置面板） ----------------------------------------------- */

function renderProjectCards(): void {
  const rules = state.settings.projects
  if (rules.length === 0) {
    ui.projectCards.replaceChildren(node('p', 'note-line', '还没有项目'))
    return
  }
  ui.projectCards.replaceChildren(
    projectHeadRow(),
    ...rules.map((rule) => {
      if (state.editingProject === rule.name) return projectEditRow(rule)
      const row = node('div', 'project')
      row.append(node('strong', 'project__name', rule.name), node('span', 'project__terms', rule.terms.join('、')))
      const actions = node('div', 'project__actions')
      const edit = node('button', 'project__edit', '编辑')
      edit.type = 'button'
      edit.dataset.projectEdit = rule.name
      const remove = node('button', 'project__remove', '删除')
      remove.type = 'button'
      remove.dataset.project = rule.name
      remove.setAttribute('aria-label', `删除项目 ${rule.name}`)
      actions.append(edit, remove)
      row.append(actions)
      return row
    })
  )
}

/** 表头：三列只写列名，不写解释 */
function projectHeadRow(): HTMLElement {
  const head = node('div', 'ptable__head')
  head.append(node('span', '', '项目名'), node('span', '', '关键词'), node('span', 'ptable__act', '操作'))
  return head
}

/** 行内编辑：同一个位置展开成两个输入，不弹窗、不换页面。 */
function projectEditRow(rule: ProjectRule): HTMLElement {
  const row = node('div', 'project project--editing')
  const fields = node('div', 'project__edit-row')
  const name = node('input')
  name.type = 'text'
  name.value = rule.name
  name.maxLength = 32
  name.autocomplete = 'off'
  name.setAttribute('aria-label', '项目名')
  const terms = node('input')
  terms.type = 'text'
  terms.value = rule.terms.join('、')
  terms.maxLength = 200
  terms.autocomplete = 'off'
  terms.setAttribute('aria-label', '关键词，逗号分隔')
  fields.append(name, terms)
  const actions = node('div', 'project__edit-actions')
  const save = node('button', 'btn btn--primary', '保存')
  save.type = 'button'
  save.dataset.projectSave = rule.name
  const cancel = node('button', 'btn btn--quiet', '取消')
  cancel.type = 'button'
  cancel.dataset.projectCancel = rule.name
  actions.append(save, cancel)
  row.append(fields, actions)
  return row
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
    setInputError(ui.projectName, '项目名不能为空')
    setPanelStatus('项目名不能为空', 'error')
    return
  }
  if (terms.length === 0) {
    setInputError(ui.projectTerms, '至少填一个关键词')
    setPanelStatus('至少填一个关键词', 'error')
    return
  }
  if (state.settings.projects.some((rule) => rule.name === name)) {
    setInputError(ui.projectName, '同名项目已存在')
    setPanelStatus('已经有同名项目', 'error')
    return
  }
  setInputError(ui.projectName, null)
  setInputError(ui.projectTerms, null)
  const saved = await applySettings({ projects: [...state.settings.projects, { name, terms }] })
  if (saved) {
    ui.projectName.value = ''
    ui.projectTerms.value = ''
  }
}

function removeProject(name: string): void {
  void applySettings({ projects: state.settings.projects.filter((rule) => rule.name !== name) })
}

/** 保存行内编辑：名字与关键词都非空，同名不同条视为冲突。 */
async function saveProjectEdit(original: string): Promise<void> {
  const row = ui.projectCards.querySelector<HTMLElement>('.project--editing')
  const inputs = row === null ? [] : [...row.querySelectorAll<HTMLInputElement>('input')]
  const name = (inputs[0]?.value ?? '').trim().slice(0, 32)
  const terms = splitTerms(inputs[1]?.value ?? '')
  if (name.length === 0 || terms.length === 0) {
    setPanelStatus('项目名与关键词都不能为空', 'error')
    return
  }
  const clash = state.settings.projects.some(
    (rule) => rule.name !== original && rule.name.toLowerCase() === name.toLowerCase()
  )
  if (clash) {
    setPanelStatus('已经有同名项目', 'error')
    return
  }
  const projects = state.settings.projects.map((rule) => (rule.name === original ? { name, terms } : rule))
  const saved = await applySettings({ projects })
  if (!saved) return
  state.editingProject = null
  renderProjectCards()
  setPanelStatus('', 'idle')
}

/* 故事线候选（v3） ---------------------------------------------------- */

function candidateRow(candidate: StoryCandidate, index: number): HTMLElement {
  const row = node('div', 'candidate')
  const head = node('div', 'candidate__head')
  // 名字可改：模型给的名字只是个提议，落盘前用户能一句话改掉
  const name = node('input', 'candidate__name')
  name.type = 'text'
  name.value = candidate.name
  name.maxLength = 32
  name.autocomplete = 'off'
  name.spellcheck = false
  name.dataset.candidateIndex = String(index)
  name.setAttribute('aria-label', '项目名')
  const add = node('button', 'btn btn--quiet candidate__add', '添加')
  add.type = 'button'
  add.dataset.candidateIndex = String(index)
  add.setAttribute('aria-label', `把 ${candidate.name} 添加为项目`)
  head.append(name, add)
  const meta = node('div', 'candidate__meta-row')
  meta.append(
    node('span', 'candidate__meta', `${candidate.scenes} 个镜头 · ${fmtMinutes(candidate.ms)}`),
    node('span', 'candidate__source', candidate.source === 'model' ? '模型' : '规则')
  )
  row.append(head, meta, node('p', 'candidate__example', candidate.example))
  return row
}

function renderCandidates(): void {
  const list = state.candidates
  if (list === null) {
    ui.candidateList.replaceChildren()
    ui.candidateHint.hidden = true
    return
  }
  if (list.length === 0) {
    ui.candidateList.replaceChildren()
    ui.candidateHint.hidden = false
    ui.candidateHint.textContent = state.candidateNote ?? '暂无候选'
    return
  }
  ui.candidateList.replaceChildren(...list.map((candidate, index) => candidateRow(candidate, index)))
  ui.candidateHint.hidden = state.candidateNote === null
  if (state.candidateNote !== null) ui.candidateHint.textContent = state.candidateNote
}

/** 只出草稿：候选不落盘，用户点“添加为项目”才变成规则。 */
async function loadCandidates(withModel: boolean): Promise<void> {
  ui.findCandidates.disabled = true
  ui.aiCandidates.disabled = true
  setPanelStatus(withModel ? '正在让模型补充…' : '正在找候选…', 'idle')
  try {
    const result = withModel ? await state.source.aiStories() : await state.source.suggestStories()
    state.candidates = result.candidates
    let note: string | null = null
    if (result.failure !== null) {
      note =
        result.failure.kind === 'not-configured'
          ? '模型通道未配置：只显示规则候选。'
          : `模型不可用：${result.failure.detail}`
    }
    state.candidateNote = note
    renderCandidates()
    setPanelStatus('', 'idle')
    // 模型候选落在「项目」分区：直接切过去，否则按钮点完像没发生
    if (withModel && result.candidates.length > 0) {
      state.settingsSection = 'projects'
      renderSettingsSection()
    }
  } catch (error) {
    state.candidates = []
    state.candidateNote = `找候选失败：${messageOf(error)}`
    renderCandidates()
    setPanelStatus('找候选失败', 'error')
  } finally {
    ui.findCandidates.disabled = false
    ui.aiCandidates.disabled = !state.settings.ai.enabled
  }
}

async function addCandidate(index: number): Promise<void> {
  const list = state.candidates
  const candidate = list?.[index]
  if (!candidate) return
  const input = ui.candidateList.querySelector<HTMLInputElement>(`input[data-candidate-index="${index}"]`)
  const name = (input?.value ?? '').trim().slice(0, 32) || candidate.name
  if (state.settings.projects.some((rule) => rule.name.toLowerCase() === name.toLowerCase())) {
    setPanelStatus('已经有同名项目', 'error')
    return
  }
  const saved = await applySettings({
    projects: [...state.settings.projects, { name, terms: [candidate.term] }]
  })
  if (!saved) return
  state.candidates = list.filter((_, position) => position !== index)
  renderCandidates()
}

/* 模型通道（v3） ------------------------------------------------------ */

function renderAiSettings(): void {
  const ai = state.settings.ai
  ui.aiEnabled.checked = ai.enabled
  if (document.activeElement !== ui.aiBaseUrl) ui.aiBaseUrl.value = ai.baseUrl
  if (document.activeElement !== ui.aiModel) ui.aiModel.value = ai.model
  const configured = ai.baseUrl.trim().length > 0 && ai.model.trim().length > 0
  ui.aiProbe.disabled = !configured
  ui.aiKeyClear.disabled = ai.apiKey.length === 0
  ui.aiCandidates.disabled = !(configured && ai.enabled)
  // key 不回显：只说明是否已设置（重置时为“未设置”）
  if (ai.apiKey.length > 0) ui.aiKey.placeholder = '已设置'
  else ui.aiKey.placeholder = '本地服务可留空'
  if (ai.enabled === false) ui.aiStatus.textContent = '模型通道已关闭。'
  else if (configured) ui.aiStatus.textContent = ''
  else ui.aiStatus.textContent = '填好接口地址与模型名后才会发请求。'
}

async function saveAi(): Promise<void> {
  const typedKey = ui.aiKey.value.trim()
  const next = {
    enabled: ui.aiEnabled.checked,
    baseUrl: ui.aiBaseUrl.value.trim(),
    model: ui.aiModel.value.trim(),
    // 留空且已有 key 时保留旧的：保存其它字段不能把 key 抹掉
    apiKey: typedKey.length > 0 ? typedKey : state.settings.ai.apiKey
  }
  if (next.baseUrl.length > 0 && !/^https?:\/\//i.test(next.baseUrl)) {
    setPanelStatus('接口地址必须以 http(s):// 开头', 'error')
    return
  }
  const saved = await applySettings({ ai: next })
  if (saved) {
    ui.aiKey.value = ''
    renderAiSettings()
  }
}

/** 显式清除：key 不回显，所以只能靠这个按钮拿掉。 */
async function clearAiKey(): Promise<void> {
  await applySettings({ ai: { ...state.settings.ai, apiKey: '' } })
  ui.aiKey.value = ''
  renderAiSettings()
}

async function probeAi(): Promise<void> {
  ui.aiProbe.disabled = true
  ui.aiStatus.textContent = '正在连接…'
  try {
    const result = await state.source.aiProbe()
    ui.aiStatus.textContent = result.ok ? '连接正常' : `连接失败：${result.detail}`
  } catch (error) {
    ui.aiStatus.textContent = `连接失败：${messageOf(error)}`
  } finally {
    ui.aiProbe.disabled = false
  }
}

/* 一周电----------------------------------------------------------- */

function shiftDate(dateISO: string, days: number): string {
  const date = new Date(startOfDay(dateISO))
  date.setDate(date.getDate() + days)
  return isoDate(date.getTime())
}

/** 周模式取一天的数据：今天用实时状态，其余读缓存*/
function cachedDay(date: string): DayRollup | null {
  const today = isoDate(Date.now())
  if (date > today) return null
  if (date === today && state.live !== null) return state.live.day
  return state.weekCache.get(date) ?? null
}

/** 本周 + 上周7 天，只补还没缓存的日期*/
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

/** 用缓存重建周模型并重绘（不发请求，tick 与设置变化都走这里）*/
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
  paintSpineCanvas()
}

/** 周模式下点任何镜头：切回日模式、载入该天、选中该镜头*/
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

/** 幕卡片第一行的文字：未/ 无采/ 有记录无镜头 / 主线*/
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
    // 固定两行：日+ 主线 / 最长与剪辑（徽标跟在第二行末尾
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
      if (act.extraMs > 0) {
        card.append(node('p', 'arc__extra', `花絮 ${fmtMinutes(act.extraMs)}`))
      }
    }
    return card
  })
  ui.weekArcs.replaceChildren(...cards)
}

/** 矩阵列头：日+ 星期一行，/ / 无记录写在下面*/
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
        // 整列没有采集：与日期下拉一致，点它去那天（不抢 Tab 焦点
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
        // 当天有这个项目以外的事，但这个项目没有：不可点、不可聚
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

/** 项目等设置变化后，周视图也要跟着重算*/
function refreshWeekIfVisible(): void {
  if (state.weekFilm !== null) refreshWeekFilm()
}

function applyWindowMaximized(maximized: boolean): void {
  windowMaximized = maximized
  ui.winMaxIcon.toggleAttribute('hidden', maximized)
  ui.winRestoreIcon.toggleAttribute('hidden', !maximized)
  ui.winMax.dataset.state = windowMaximized ? 'maximized' : 'normal'
  ui.winMax.setAttribute('aria-label', maximized ? '还原窗口' : '最大化')
}

function bindEvents(): void {
  ui.search.addEventListener('input', scheduleSearch)
  // 上一集：整行可点（键盘同样可用），切到那天并选中那个镜头
  ui.episode.addEventListener('click', () => {
    if (episodeRef !== null) void gotoEpisode(episodeRef)
  })
  ui.episode.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (episodeRef === null) return
    event.preventDefault()
    void gotoEpisode(episodeRef)
  })
  // 无边框窗口按钮（主进程未就绪时忽略）
  ui.winMin.addEventListener('click', () => windowBridge?.minimize?.())
  ui.winMax.addEventListener('click', () => windowBridge?.toggleMaximize?.())
  ui.winClose.addEventListener('click', () => windowBridge?.close?.())
  ui.dragRegion.addEventListener('dblclick', () => windowBridge?.toggleMaximize?.())
  ui.onboardStart.addEventListener('click', () => {
    try {
      window.localStorage.setItem(ONBOARDED_KEY, '1')
    } catch {
      // 无 localStorage（隐私模式）时只本次隐藏
    }
    renderDay()
  })
  ui.onboardSettings.addEventListener('click', openPanel)
  applyWindowMaximized(false)
  // 顶栏菜单：导出（脚本/PDF/EDL/海报三主题）与「···」（对比/日历）
  ui.exportMenuBtn.addEventListener('click', () => toggleMenu(ui.exportMenu, ui.exportMenuBtn))
  ui.moreMenuBtn.addEventListener('click', () => toggleMenu(ui.moreMenu, ui.moreMenuBtn))
  ui.exportMenu.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const item = target.closest<HTMLElement>('[data-theme]')
    const theme = item?.dataset.theme
    if (theme !== 'classic' && theme !== 'noir' && theme !== 'minimal') return
    closeMenus()
    void exportPoster(theme)
  })
  ui.exportMenu.addEventListener('keydown', onMenuKey)
  ui.moreMenu.addEventListener('keydown', onMenuKey)
  ui.exportScriptBtn.addEventListener('click', () => {
    closeMenus()
    void exportDay()
  })
  ui.exportPdfBtn.addEventListener('click', () => {
    closeMenus()
    void exportPdfNow()
  })
  ui.exportEdlBtn.addEventListener('click', () => {
    closeMenus()
    void exportEdlNow()
  })
  document.addEventListener('pointerdown', (event) => {
    if (openMenuPanel === null) return
    const target = event.target
    if (
      target instanceof Node &&
      (openMenuPanel.contains(target) || (openMenuAnchor?.contains(target) ?? false))
    ) {
      return
    }
    closeMenus()
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
  ui.spineScroll.addEventListener('click', onSpineClick)
  ui.spineScroll.addEventListener('keydown', onSpineKey)
  ui.spineScroll.addEventListener('wheel', onSpineWheel, { passive: false })
  ui.spineScroll.addEventListener('scroll', () => {
    if (scrollRaf !== 0) return
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0
      paintSpineCanvas()
    })
  })
  ui.listScroll.addEventListener('scroll', onListScroll)
  ui.listScroll.addEventListener('keydown', onListKey)
  ui.settingsBtn.addEventListener('click', openPanel)
  ui.drawerScrim.addEventListener('click', closePanel)
  ui.panelClose.addEventListener('click', closePanel)
  document.addEventListener('keydown', onPanelKey)
  ui.termForm.addEventListener('submit', (event) => {
    event.preventDefault()
    void addTerm()
  })
  for (const input of [ui.termInput, ui.projectName, ui.projectTerms]) {
    input.addEventListener('input', () => setInputError(input, null))
  }
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
  ui.hudToggle.addEventListener('change', () => {
    void applyHudVisible(ui.hudToggle.checked)
  })
  ui.quitBtn.addEventListener('click', () => {
    void quitApp()
  })
  ui.exitProjection.addEventListener('click', stopProjection)
  ui.soundToggle.addEventListener('click', () => {
    projection = setProjectionSound(projection, !projection.sound)
    projectorAudio.setVolume(state.settings.sound.volume)
  projectorAudio.setMode(state.settings.sound.mode)
  projectorAudio.setEnabled(projection.sound)
    if (projection.sound) startAudioMeter()
    else stopAudioMeter()
    ui.soundToggle.textContent = projection.sound ? '声音：开' : '声音：关'
    ui.soundToggle.setAttribute('aria-pressed', String(projection.sound))
  })
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !projection.active) return
    event.preventDefault()
    stopProjection()
  })
  // 浮层的 Esc：菜单 → 日历 → 对比，逐层关闭；Tab 锁在浮层内
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      if (state.calendarOpen) trapTab(event, ui.calendar)
      else if (state.compareOpen) trapTab(event, ui.compare)
      return
    }
    if (event.key !== 'Escape') return
    if (openMenuPanel !== null) {
      event.preventDefault()
      const anchor = openMenuAnchor
      closeMenus()
      anchor?.focus({ preventScroll: true })
      return
    }
    if (state.calendarOpen) {
      event.preventDefault()
      closeCalendar()
      return
    }
    if (state.compareOpen) {
      event.preventDefault()
      closeCompare()
    }
  })
  // 全局快捷键 Ctrl+Alt+P 的放映切换（R54）；没有该能力时忽略
  window.dayfilmProjection?.onToggle(() => {
    if (projection.active) stopProjection()
    else startProjection()
  })
  ui.compareOpenBtn.addEventListener('click', () => {
    closeMenus()
    void openCompare()
  })
  ui.compareClose.addEventListener('click', closeCompare)
  ui.compareScrim.addEventListener('click', closeCompare)
  ui.compare.addEventListener('change', (event) => {
    const target = event.target
    if (!(target instanceof HTMLSelectElement) || !target.dataset.side) return
    const side = target.dataset.side === 'left' ? 'left' : 'right'
    state.compareDates = { ...state.compareDates, [side]: target.value }
    void renderCompare()
  })
  ui.compare.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const band = target.closest<HTMLElement>('.compare__band')
    if (!band || band.hasAttribute('disabled')) return
    const date = band.dataset.date
    if (!date) return
    closeCompare()
    void selectDay(date)
  })
  ui.calendarOpenBtn.addEventListener('click', () => {
    closeMenus()
    void openCalendar()
  })
  // v2.6 批量标记（··· 菜单）
  ui.markUnder10.addEventListener('click', () => {
    closeMenus()
    void bulkMark('under10')
  })
  ui.markAuto.addEventListener('click', () => {
    closeMenus()
    void bulkMark('auto')
  })
  ui.markClear.addEventListener('click', () => {
    closeMenus()
    void bulkMark('clear')
  })
  // v2.6 放映音效
  ui.soundModeProjector.addEventListener('click', () => {
    void applySound({ mode: 'projector' })
  })
  ui.soundModeCuts.addEventListener('click', () => {
    void applySound({ mode: 'cuts' })
  })
  ui.soundVolume.addEventListener('input', () => {
    ui.soundVolumeValue.textContent = ui.soundVolume.value
    void applySound({ volume: Number(ui.soundVolume.value) / 100 })
  })
  ui.calendarClose.addEventListener('click', closeCalendar)
  ui.calendarScrim.addEventListener('click', closeCalendar)
  ui.calendarGrid.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const cell = target.closest<HTMLElement>('[data-date]')
    const date = cell?.dataset.date
    if (!date) return
    closeCalendar()
    void selectDay(date)
  })
  ui.note.addEventListener('input', onNoteInput)
  ui.projectForm.addEventListener('submit', (event) => {
    event.preventDefault()
    void addProject()
  })
  ui.projectCards.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const edit = target.closest<HTMLElement>('[data-project-edit]')
    if (edit?.dataset.projectEdit !== undefined) {
      state.editingProject = edit.dataset.projectEdit
      renderProjectCards()
      return
    }
    const cancel = target.closest<HTMLElement>('[data-project-cancel]')
    if (cancel !== null) {
      state.editingProject = null
      renderProjectCards()
      return
    }
    const save = target.closest<HTMLElement>('[data-project-save]')
    if (save?.dataset.projectSave !== undefined) {
      void saveProjectEdit(save.dataset.projectSave)
      return
    }
    const remove = target.closest<HTMLElement>('[data-project]')
    const name = remove?.dataset.project
    if (name) removeProject(name)
  })
  ui.findCandidates.addEventListener('click', () => {
    void loadCandidates(false)
  })
  ui.aiCandidates.addEventListener('click', () => {
    void loadCandidates(true)
  })
  ui.candidateList.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const button = target.closest<HTMLElement>('[data-candidate-index]')
    if (!(button instanceof HTMLButtonElement)) return
    const index = Number(button.dataset.candidateIndex)
    if (Number.isInteger(index)) void addCandidate(index)
  })
  ui.aiEnabled.addEventListener('change', () => {
    void saveAi()
  })
  ui.aiSave.addEventListener('click', () => {
    void saveAi()
  })
  ui.aiProbe.addEventListener('click', () => {
    void probeAi()
  })
  ui.aiKeyClear.addEventListener('click', () => {
    void clearAiKey()
  })
  ui.settingsNav.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const item = target.closest<HTMLElement>('.nav-item')
    const section = item?.dataset.section as SettingsSection | undefined
    if (!section) return
    state.settingsSection = section
    renderSettingsSection()
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
    paintSpineCanvas()
  }, 1000)
}

export async function boot(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#app')
  if (!root) return
  appRoot = root
  ui = collect(root)

  const source = createSource()
  const dates = await source.listDays()
  const today = isoDate(Date.now())
  // 当天即使还没有日文件也默认今天并走空状态，不能退回上一
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
    search: null,
    playing: false,
    speed: 600,
    playhead: 0,
    settings: { ...DEFAULT_SETTINGS, redactTerms: [], projects: [] },
    settingsReady: false,
    panelOpen: false,
    browsingHistory: false,
    datesRefreshedFor: null,
    note: '',
    noteSaved: '',
    mode: 'day',
    weekMonday: mondayOf(today),
    weekCache: new Map(),
    weekThisDays: [],
    weekLastDays: [],
    weekFilm: null,
    weekLoading: false,
    compareOpen: false,
    compareDates: { left: '', right: '' },
    compareCache: new Map(),
    calendarOpen: false,
    calendarDays: new Map(),
    calendarLoading: false,
    settingsSection: 'projects',
    editingProject: null,
    candidates: null,
    candidateNote: null
  }
  state.playhead = initialPlayhead()

  ui.spineSpacer.style.height = `${spineHeight()}px`
  // 自绘下拉框：日期与保留期（替换原生 select）
  dateSelect = createSelect({
    label: '日期',
    options: [],
    value: state.date,
    onChange: (value) => {
      ui.search.value = ''
      state.search = null
      resetListScroll()
      void loadDate(value)
    }
  })
  ui.date.replaceChildren(dateSelect.element)
  retentionSelect = createSelect({
    label: '保留期',
    options: RETENTION_OPTIONS.map((option) => ({ value: String(option.value), label: option.label })),
    value: String(state.settings.retentionDays),
    onChange: (value) => {
      void applySettings({ retentionDays: Number(value) })
    }
  })
  ui.retention.replaceChildren(retentionSelect.element)
  autoExtraSelect = createSelect({
    label: '自动花絮',
    options: AUTO_EXTRA_OPTIONS.map((option) => ({ value: String(option.value), label: option.label })),
    value: String(state.settings.autoExtraUnderSec),
    onChange: (value) => {
      void applySettings({ autoExtraUnderSec: Number(value) })
    }
  })
  ui.autoExtra.replaceChildren(autoExtraSelect.element)
  // 最大化状态由主进程推送；桥接缺席时忽略
  windowBridge?.onMaximizeChange?.((maximized) => applyWindowMaximized(maximized))
  renderDates()
  renderSettingsStatic()
  renderSettings()
  renderCandidates()
  renderLive()
  setSpeed(state.speed)
  setPlayButton(false)
  measure()
  renderDay()
  revealSpine(state.playhead)
  paintSpineCanvas()
  bindEvents()

  // 字体就绪后再画一次剧照（有文字版本）
  onStillFontsReady(() => {
    frameKey = ''
    listSignature = ''
    windowSignature = ''
    renderDay()
    paintSpineCanvas()
  })

  void loadNote(date)
  void loadSettings()
  // 上一集要用项目规则，先拿回设置后查一次；之后只在切日与设置变化时重查
  void loadEpisode()

  const observer = new ResizeObserver(measure)
  observer.observe(ui.spineScroll)
  observer.observe(ui.listScroll)
  source.onTick(handleTick)
}

