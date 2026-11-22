// 用户设置与脱敏规则的共享定义。主进程负责持久化，界面只负责展示与提交。

/** 项目规则：把镜头归到"故事线"上，而不是散落的进程名。 */
export interface ProjectRule {
  /** 项目名，界面显示 */
  name: string
  /** 命中关键词（标题或进程名，不区分大小写） */
  terms: string[]
}

/** 导演 HUD：置顶小窗的开关与上次位置。 */
export interface HudSettings {
  visible: boolean
  /** 屏幕坐标；null 表示还没拖过，用默认位置 */
  x: number | null
  y: number | null
}

export interface Settings {
  /** 保留天数；0 表示不自动清理 */
  retentionDays: number
  /** 用户自定义脱敏关键词，命中即隐藏标题 */
  redactTerms: string[]
  /** 开机自启 */
  autoStart: boolean
  /** 用户手动暂停采样 */
  paused: boolean
  /** 项目规则；命中最先匹配的一条 */
  projects: ProjectRule[]
  /** 导演 HUD */
  hud: HudSettings
}

export const DEFAULT_SETTINGS: Settings = {
  retentionDays: 30,
  redactTerms: [],
  autoStart: false,
  paused: false,
  projects: [],
  hud: { visible: true, x: null, y: null }
}

export const RETENTION_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天' },
  { value: 90, label: '90 天' },
  { value: 365, label: '365 天' },
  { value: 0, label: '不自动清理' }
] as const

/** 内置脱敏关键词，与规格 R10.2 一致。界面只展示，不可在界面编辑。 */
export const BUILTIN_REDACT_TERMS: readonly string[] = [
  '1password',
  'keepass',
  'bitwarden',
  'lastpass',
  'incognito',
  'inprivate',
  '隐私',
  'bank',
  '银行',
  '网银',
  '支付',
  'wallet'
] as const

export const REDACTED_TITLE = '[已隐藏]'
