import type { Settings } from './settings'
import type { StorySuggestions } from './stories'
import type { DayRollup, EpisodeRef, LiveState, SceneMark, ScreenplayExport, SearchOutcome } from './types'

/** IPC 通道名。主进程与 preload 共用，避免字符串漂移。 */
export const IPC = {
  getDay: 'dayfilm:get-day',
  listDays: 'dayfilm:list-days',
  live: 'dayfilm:live',
  search: 'dayfilm:search',
  previousEpisode: 'dayfilm:previous-episode',
  exportScreenplay: 'dayfilm:export-screenplay',
  getSettings: 'dayfilm:get-settings',
  setSettings: 'dayfilm:set-settings',
  getNote: 'dayfilm:get-note',
  setNote: 'dayfilm:set-note',
  saveImage: 'dayfilm:save-image',
  exportEdl: 'dayfilm:export-edl',
  exportPdf: 'dayfilm:export-pdf',
  setMark: 'dayfilm:set-mark',
  suggestStories: 'dayfilm:suggest-stories',
  aiStories: 'dayfilm:ai-stories',
  aiProbe: 'dayfilm:ai-probe',
  setHud: 'dayfilm:set-hud',
  quit: 'dayfilm:quit',
  tick: 'dayfilm:tick'
} as const

/** preload 通过 contextBridge 暴露到 window.dayfilm 的接口。 */
export interface DayfilmApi {
  getDay(date?: string): Promise<DayRollup>
  listDays(): Promise<string[]>
  live(): Promise<LiveState>
  search(query: string): Promise<SearchOutcome>
  /** 所查看日期的锚点（最长镜头）上一次出现在哪一天；没有命中返回 null。 */
  previousEpisode(date: string): Promise<EpisodeRef | null>
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
  /** 把某一天导出成 CMX3600 EDL（24fps），返回落盘路径；取消返回空串。 */
  exportEdl(date: string): Promise<{ path: string }>
  /** 把某一天的剧本导出成 PDF，返回落盘路径；取消返回空串。 */
  exportPdf(date: string): Promise<{ path: string }>
  /** 给某个镜头打标记（正片 / 花絮 / 清除），返回重算后的当日汇总。 */
  setMark(date: string, startMs: number, mark: SceneMark | null): Promise<DayRollup>
  /** 从最近 30 天的标题里找故事线候选（纯规则，不发网络请求）。 */
  suggestStories(): Promise<StorySuggestions>
  /** 用户点按钮时让模型补充候选；失败时仍返回确定性候选，failure 说明原因。 */
  aiStories(): Promise<StorySuggestions>
  /** 设置页的“测试连接”：验证基址、key 与模型名。 */
  aiProbe(): Promise<{ ok: boolean; detail: string }>
  /** 显示/隐藏导演 HUD，返回切换后的状态。 */
  setHud(visible: boolean): Promise<{ visible: boolean }>
  /** 真正退出应用（含停止采集）。 */
  quit(): Promise<void>
  /** 订阅主进程每 2 秒推送的实时状态，返回取消订阅函数。 */
  onTick(cb: (state: LiveState) => void): () => void
}

/** 主进程推给界面的放映切换事件（全局快捷键 Ctrl+Alt+P）。 */
export interface ProjectionBridge {
  onToggle(cb: () => void): () => void
}

declare global {
  interface Window {
    dayfilm: DayfilmApi
    /** 打包/开发环境都会注入；缺失时界面应忽略该能力。 */
    dayfilmProjection?: ProjectionBridge
  }
}
