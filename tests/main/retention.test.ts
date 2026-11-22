import { describe, expect, it } from 'vitest'
import { cleanupExpired, type RetentionStore } from '../../src/main/retention'
import { localDate } from '../../src/main/store'

const NOW = new Date(2026, 11, 22, 12, 0, 0).getTime()

class FakeStore implements RetentionStore {
  readonly removed: string[] = []

  constructor(
    private readonly days: string[],
    private readonly failing: string[] = []
  ) {}

  listDays(): string[] {
    return [...this.days]
  }

  removeDay(date: string): void {
    if (this.failing.includes(date)) {
      const error = new Error('EPERM: operation not permitted') as NodeJS.ErrnoException
      error.code = 'EPERM'
      throw error
    }
    this.removed.push(date)
  }
}

describe('cleanupExpired', () => {
  it('删除早于保留期的日文件，保留期内的不动', () => {
    const store = new FakeStore(['2026-12-22', '2026-12-20', '2026-11-22', '2026-11-01'])
    const result = cleanupExpired(store, 30, NOW)
    // 30 天前的分界线是 2026-11-22：它本身保留，只删更早的
    expect(result.removed).toEqual(['2026-11-01'])
    expect(result.errors).toEqual([])
  })

  it('保留天数 0 表示不清理', () => {
    const store = new FakeStore(['2020-01-01', '2026-12-22'])
    expect(cleanupExpired(store, 0, NOW)).toEqual({ removed: [], errors: [] })
    expect(store.removed).toEqual([])
  })

  it('删不掉的文件被收集成错误，其余照删', () => {
    const store = new FakeStore(['2026-01-01', '2026-02-01'], ['2026-01-01'])
    const result = cleanupExpired(store, 7, NOW)
    expect(result.removed).toEqual(['2026-02-01'])
    expect(result.errors).toEqual([{ date: '2026-01-01', message: 'EPERM' }])
  })

  it('分界线按本地日期算，7 天保留期留得住 6 天前的数据', () => {
    const cutoffDay = localDate(NOW - 7 * 86_400_000)
    const store = new FakeStore([cutoffDay, localDate(NOW - 8 * 86_400_000)])
    const result = cleanupExpired(store, 7, NOW)
    expect(result.removed).toEqual([localDate(NOW - 8 * 86_400_000)])
  })

  it('没有日文件时什么都不做', () => {
    expect(cleanupExpired(new FakeStore([]), 30, NOW)).toEqual({ removed: [], errors: [] })
  })
})
