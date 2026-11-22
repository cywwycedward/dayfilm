import { formatDurationSpan } from '../reel/rules'

/** 托盘需要的状态快照。纯文本函数放这里，方便不启动 Electron 就能测。 */
export interface TrayState {
  paused: boolean
  captureError: string | null
  storageError: string | null
  /** 当日已记录（非空闲）时长 */
  activeMs: number
}

/** 托盘的三种状态，图标、提示文字、菜单都从它派生，避免各算一套。 */
export type TrayMood = 'active' | 'paused' | 'error'

/** 品牌图标文件名（在 resources/ 下，打包后进 process.resourcesPath）。 */
export const TRAY_ICON_FILES: Record<TrayMood, string> = {
  active: 'tray.png',
  paused: 'tray-paused.png',
  error: 'tray-error.png'
}

const STATUS_LABELS: Record<TrayMood, string> = {
  active: '采集中',
  paused: '已暂停',
  error: '出错'
}

export function trayMood(state: TrayState): TrayMood {
  if (state.captureError || state.storageError) return 'error'
  if (state.paused) return 'paused'
  return 'active'
}

export function trayStatusLabel(state: TrayState): string {
  return STATUS_LABELS[trayMood(state)]
}

/** 实际用哪张图：对应状态的文件缺失时回落到采集中图标（规格 R12.2）。 */
export function resolveTrayMood(state: TrayState, available: ReadonlySet<TrayMood>): TrayMood {
  const mood = trayMood(state)
  return available.has(mood) ? mood : 'active'
}

/** 实际用哪个图标文件；名字口径给测试与日志用。 */
export function trayIconFile(state: TrayState, available: ReadonlySet<TrayMood>): string {
  return TRAY_ICON_FILES[resolveTrayMood(state, available)]
}

/** `Dayfilm · 采集中 · 今日 1 小时 12 分钟`（规格 R12.2）。 */
export function trayTooltip(state: TrayState): string {
  const parts = [`Dayfilm · ${trayStatusLabel(state)}`]
  if (state.activeMs > 0) parts.push(`今日 ${formatDurationSpan(state.activeMs)}`)
  return parts.join(' · ')
}

/** 菜单项文字随状态切换：运行中显示"暂停采样"，暂停时显示"继续采样"。 */
export function pauseMenuLabel(paused: boolean): string {
  return paused ? '继续采样' : '暂停采样'
}
