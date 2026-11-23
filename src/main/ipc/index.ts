import { IPC } from '../../shared/ipc'
import type { Settings } from '../../shared/settings'
import type { DayRollup, LiveState, Scene, ScreenplayExport } from '../../shared/types'

/**
 * 受来源守卫包装的 invoke 通道：`IPC` 里除单向推送的 `tick` 之外全部。
 * 这里是“注册哪些通道”的唯一来源——新增通道却漏了守卫，`tests/main/ipc.test.ts` 会失败。
 */
export const GUARDED_CHANNELS = {
  getDay: IPC.getDay,
  listDays: IPC.listDays,
  live: IPC.live,
  search: IPC.search,
  exportScreenplay: IPC.exportScreenplay,
  getSettings: IPC.getSettings,
  setSettings: IPC.setSettings,
  getNote: IPC.getNote,
  setNote: IPC.setNote,
  saveImage: IPC.saveImage,
  exportEdl: IPC.exportEdl,
  exportPdf: IPC.exportPdf,
  setMark: IPC.setMark,
  setHud: IPC.setHud,
  quit: IPC.quit
} as const

export type GuardedChannel = (typeof GUARDED_CHANNELS)[keyof typeof GUARDED_CHANNELS]

export type GuardedHandler = (...args: unknown[]) => unknown

/**
 * 单向 `send` 通道（不带返回、不走 `DayfilmApi`）。契约（`src/shared/ipc.ts`）由主 Agent 维护，
 * 这里只登记通道名，preload 与主进程共用，避免字符串漂移。
 */
export const HUD_OPEN_CHANNEL = 'dayfilm:hud-open'

export const SEND_CHANNELS = {
  hudOpen: HUD_OPEN_CHANNEL
} as const

export type SendChannel = (typeof SEND_CHANNELS)[keyof typeof SEND_CHANNELS]

/**
 * 主进程单向通知渲染进程的通道（`webContents.send`，没有入参也不需要守卫）。
 * 同样登记在案，避免界面与主进程各写一个字符串。
 */
export const PROJECTION_TOGGLE_CHANNEL = 'dayfilm:projection-toggle'
/** 最大化状态变化（boolean）：界面据此换窗口按钮图标。 */
export const MAXIMIZED_CHANGED_CHANNEL = 'dayfilm:maximized-changed'

export const OUTBOUND_CHANNELS = {
  projectionToggle: PROJECTION_TOGGLE_CHANNEL,
  maximizedChanged: MAXIMIZED_CHANGED_CHANNEL
} as const

export type OutboundChannel = (typeof OUTBOUND_CHANNELS)[keyof typeof OUTBOUND_CHANNELS]

/**
 * 无边框窗口的窗口按钮通道。契约（`src/shared/ipc.ts`）还没收录，所以先登记在这里，
 * preload 与主进程共用同一份字符串。
 */
export const WINDOW_CHANNELS = {
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggle-maximize',
  close: 'window:close'
} as const

export type WindowChannel = (typeof WINDOW_CHANNELS)[keyof typeof WINDOW_CHANNELS]

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export type DayRequest = { kind: 'today' } | { kind: 'requested'; date: string } | { kind: 'invalid'; date: string }

/** getDay 的入参归一：缺省取今天；非法日期返回空汇总，但日期字段要回填请求的那个。 */
export function parseDayRequest(date: unknown): DayRequest {
  if (typeof date !== 'string') return { kind: 'today' }
  return DATE_PATTERN.test(date) ? { kind: 'requested', date } : { kind: 'invalid', date }
}

export interface IpcDeps {
  getDay(date: unknown): DayRollup
  listDays(): string[]
  live(): LiveState
  search(query: unknown): Scene[]
  exportScreenplay(date: unknown): Promise<ScreenplayExport> | ScreenplayExport
  getSettings(): Settings
  setSettings(patch: unknown): Settings
  getNote(date: unknown): string
  setNote(date: unknown, text: unknown): string
  saveImage(defaultName: unknown, pngBase64: unknown): Promise<{ path: string }> | { path: string }
  exportEdl(date: unknown): Promise<{ path: string }> | { path: string }
  exportPdf(date: unknown): Promise<{ path: string }> | { path: string }
  setMark(date: unknown, startMs: unknown, mark: unknown): DayRollup
  setHud(visible: unknown): { visible: boolean }
  quit(): void
}

/** 通道 → 实现。`Record<GuardedChannel, …>` 保证漏一个通道就编译不过。 */
export function createHandlers(deps: IpcDeps): Record<GuardedChannel, GuardedHandler> {
  return {
    [IPC.getDay]: (date) => deps.getDay(date),
    [IPC.listDays]: () => deps.listDays(),
    [IPC.live]: () => deps.live(),
    [IPC.search]: (query) => deps.search(query),
    [IPC.exportScreenplay]: (date) => deps.exportScreenplay(date),
    [IPC.getSettings]: () => deps.getSettings(),
    [IPC.setSettings]: (patch) => deps.setSettings(patch),
    [IPC.getNote]: (date) => deps.getNote(date),
    [IPC.setNote]: (date, text) => deps.setNote(date, text),
    [IPC.saveImage]: (defaultName, pngBase64) => deps.saveImage(defaultName, pngBase64),
    [IPC.exportEdl]: (date) => deps.exportEdl(date),
    [IPC.exportPdf]: (date) => deps.exportPdf(date),
    [IPC.setMark]: (date, startMs, mark) => deps.setMark(date, startMs, mark),
    [IPC.setHud]: (visible) => deps.setHud(visible),
    [IPC.quit]: () => deps.quit()
  }
}

export interface SendDeps {
  /** HUD 被单击：打开并聚焦主窗口 */
  hudOpen(): void
}

/** send 通道 → 实现；与 invoke 通道一样必须逐个登记，漏了就编译不过。 */
export function createSendHandlers(deps: SendDeps): Record<SendChannel, GuardedHandler> {
  return {
    [HUD_OPEN_CHANNEL]: () => deps.hudOpen()
  }
}

export interface WindowDeps {
  minimize(): void
  /** 返回切换后的最大化状态 */
  toggleMaximize(): boolean
  /** 隐藏到托盘（不退出应用） */
  close(): void
}

/** 窗口按钮通道 → 实现；同样逐个登记。 */
export function createWindowHandlers(deps: WindowDeps): Record<WindowChannel, GuardedHandler> {
  return {
    [WINDOW_CHANNELS.minimize]: () => deps.minimize(),
    [WINDOW_CHANNELS.toggleMaximize]: () => ({ maximized: deps.toggleMaximize() }),
    [WINDOW_CHANNELS.close]: () => deps.close()
  }
}
