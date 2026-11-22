import { localDate } from '../store'
import { describeError } from '../errors'

const DAY_MS = 86_400_000

export interface RetentionStore {
  /** 已有的日文件日期，倒序 */
  listDays(): string[]
  /** 删除某日文件，失败抛出 */
  removeDay(date: string): void
}

export interface RetentionResult {
  removed: string[]
  errors: { date: string; message: string }[]
}

/**
 * 删除文件名日期早于 `now - retentionDays` 的日文件（规格 R11.2）。
 * retentionDays 为 0 表示不自动清理；单个文件删不掉只记录，不影响其余。
 */
export function cleanupExpired(store: RetentionStore, retentionDays: number, now: number): RetentionResult {
  const result: RetentionResult = { removed: [], errors: [] }
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return result
  const cutoff = localDate(now - retentionDays * DAY_MS)
  for (const date of store.listDays()) {
    if (date >= cutoff) continue
    try {
      store.removeDay(date)
      result.removed.push(date)
    } catch (error) {
      result.errors.push({ date, message: describeError(error) })
    }
  }
  return result
}
