import { IPC } from '../../shared/ipc'
import type { Settings } from '../../shared/settings'
import type { DayRollup, LiveState, Scene, ScreenplayExport } from '../../shared/types'

/**
 * 受来源守卫包装的通道：`IPC` 里除单向推送的 `tick` 之外全部。
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
  quit: IPC.quit
} as const

export type GuardedChannel = (typeof GUARDED_CHANNELS)[keyof typeof GUARDED_CHANNELS]

export type GuardedHandler = (...args: unknown[]) => unknown

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
    [IPC.quit]: () => deps.quit()
  }
}
