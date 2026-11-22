import { formatDurationSpan } from '../reel/rules'

/** 托盘需要的状态快照。纯文本函数放这里，方便不启动 Electron 就能测。 */
export interface TrayState {
  paused: boolean
  captureError: string | null
  storageError: string | null
  /** 当日已记录（非空闲）时长 */
  activeMs: number
}

export function trayStatusLabel(state: TrayState): string {
  if (state.captureError || state.storageError) return '出错'
  if (state.paused) return '已暂停'
  return '采集中'
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
