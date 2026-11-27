// 主进程与渲染进程共用的数据契约。改动时同步 src/preload 与 UI。

export interface Sample {
  /** 采样时刻，毫秒时间戳 */
  t: number
  /** 前台进程名，例如 WindowsTerminal */
  exe: string
  /** 前台窗口标题 */
  title: string
  /** 距最后一次用户输入的空闲毫秒数 */
  idleMs: number
}

export type SceneKind = 'shot' | 'intermission'

/**
 * 导演剪辑版标记：正片（feature）计入"正片时长"，花絮（extra）只作参考。
 * 未标记的镜头按正片算。
 */
export type SceneMark = 'feature' | 'extra'

/** 一段连续处于同一前台窗口的时间，构成影片中的一个镜头。 */
export interface Scene {
  id: string
  start: number
  end: number
  exe: string
  title: string
  seconds: number
  kind: SceneKind
  /** 用户手动标记；未标记表示正片 */
  mark?: SceneMark
  /** 标记来源：手动点选，或按"自动把短片算花絮"的规则 */
  markSource?: 'manual' | 'auto'
}

export interface TopApp {
  exe: string
  seconds: number
}

/** 把专注模式翻译成剪辑语言的结论。 */
export interface Verdict {
  label: string
  note: string
  /** 每小时场景切换次数 */
  cutRate: number
}

export interface DayRollup {
  /** 本地日期，YYYY-MM-DD */
  date: string
  firstAt: number | null
  lastAt: number | null
  /** 非空闲总时长（毫秒） */
  activeMs: number
  /** 空闲总时长（毫秒） */
  idleMs: number
  scenes: Scene[]
  /** 非空闲镜头之间的切换次数 */
  cuts: number
  /** 跨应用切换的次数（v4；缺省按 0 读，兼容旧夹具与旧快照） */
  appCuts?: number
  /** 同一应用内换窗口的次数（v4；同上） */
  withinAppCuts?: number
  longestShot: Scene | null
  topApps: TopApp[]
  verdict: Verdict
  /** 计入正片的时长（毫秒）：未标记与标记为 feature 的镜头之和 */
  featureMs: number
  /** 被标成花絮的时长（毫秒） */
  extraMs: number
}

export interface LiveState {
  /** 采集子进程存活 */
  capturing: boolean
  captureError: string | null
  /** 落盘异常，例如磁盘写失败；正常为 null */
  storageError: string | null
  /** 用户手动暂停了采样 */
  paused: boolean
  now: number
  /** 正在拍摄的镜头，空闲时为 null */
  scene: Scene | null
  day: DayRollup
}

export interface ScreenplayExport {
  path: string
}

/** 一条命中的理由：真正命中的词（小写）与真正起作用的日期。 */
export interface SearchReason {
  tokens: string[]
  dates: string[]
}

export interface SearchHit {
  scene: Scene
  reason: SearchReason
}

/** 检索覆盖情况：全在保留范围内 / 部分日期已被清理 / 日期全部超出保留范围。 */
export type SearchCoverage = 'full' | 'partial' | 'expired'

export interface SearchOutcome {
  hits: SearchHit[]
  coverage: SearchCoverage
  /** 保留范围内最早的日期；没有数据为 null */
  retainedFrom: string | null
}

/** 上一集：所查看日期的锚点上一次出现的镜头。 */
export interface EpisodeRef {
  date: string
  start: number
  exe: string
  title: string
  seconds: number
  /** 命中依据：原始标题完全相同，或属于同一个项目 */
  match: 'title' | 'project'
  /** 命中镜头所属项目；没有命中任何项目规则时为 null */
  project: string | null
}
