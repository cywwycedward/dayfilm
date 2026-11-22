import type { Settings } from './settings'
import type { DayRollup, LiveState, Scene, ScreenplayExport } from './types'

/** IPC 通道名。主进程与 preload 共用，避免字符串漂移。 */
export const IPC = {
  getDay: 'dayfilm:get-day',
  listDays: 'dayfilm:list-days',
  live: 'dayfilm:live',
  search: 'dayfilm:search',
  exportScreenplay: 'dayfilm:export-screenplay',
  getSettings: 'dayfilm:get-settings',
  setSettings: 'dayfilm:set-settings',
  getNote: 'dayfilm:get-note',
  setNote: 'dayfilm:set-note',
  saveImage: 'dayfilm:save-image',
  quit: 'dayfilm:quit',
  tick: 'dayfilm:tick'
} as const

/** preload 通过 contextBridge 暴露到 window.dayfilm 的接口。 */
export interface DayfilmApi {
  getDay(date?: string): Promise<DayRollup>
  listDays(): Promise<string[]>
  live(): Promise<LiveState>
  search(query: string): Promise<Scene[]>
  exportScreenplay(date: string): Promise<ScreenplayExport>
  getSettings(): Promise<Settings>
  /** 只提交需要改动的字段，返回落盘后的完整设置。 */
  setSettings(patch: Partial<Settings>): Promise<Settings>
  /** 读取某天的导演手记，没有时返回空串。 */
  getNote(date: string): Promise<string>
  /** 写入某天的导演手记，返回落盘后的内容（超长会被截断）。 */
  setNote(date: string, text: string): Promise<string>
  /** 把界面渲染好的 PNG（base64，不带 data: 前缀）存到用户选择的路径。 */
  saveImage(defaultName: string, pngBase64: string): Promise<{ path: string }>
  /** 真正退出应用（含停止采集）。 */
  quit(): Promise<void>
  /** 订阅主进程每 2 秒推送的实时状态，返回取消订阅函数。 */
  onTick(cb: (state: LiveState) => void): () => void
}

declare global {
  interface Window {
    dayfilm: DayfilmApi
  }
}
