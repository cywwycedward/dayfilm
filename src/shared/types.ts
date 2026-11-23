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
