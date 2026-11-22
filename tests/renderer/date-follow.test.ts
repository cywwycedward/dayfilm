import { describe, expect, test } from 'vitest'
import { followDate, type DateFollowInput } from '../../src/renderer/src/lib/date-follow'

const base: DateFollowInput = {
  current: '2025-01-15',
  today: '2025-01-15',
  browsingHistory: false,
  liveDate: '2025-01-15',
  knownDates: ['2025-01-15', '2025-01-14'],
  refreshedFor: null
}

describe('followDate', () => {
  test('过零点：跟到新的一天，并重取日期列表', () => {
    const result = followDate({
      ...base,
      current: '2025-01-15',
      today: '2025-01-16',
      liveDate: '2025-01-16',
      knownDates: ['2025-01-15', '2025-01-14']
    })
    expect(result.nextDate).toBe('2025-01-16')
    expect(result.refreshDates).toBe(true)
  })

  test('今天还没有数据（新一天不在列表里）也跟到今天', () => {
    const result = followDate({
      ...base,
      current: '2025-01-15',
      today: '2025-01-16',
      liveDate: '2025-01-16',
      knownDates: ['2025-01-14']
    })
    expect(result.nextDate).toBe('2025-01-16')
    expect(result.refreshDates).toBe(true)
  })

  test('用户正在看历史：视图不动，只把下拉框补新', () => {
    const onHistory = followDate({
      ...base,
      current: '2025-01-13',
      today: '2025-01-16',
      liveDate: '2025-01-16',
      browsingHistory: true,
      knownDates: ['2025-01-15', '2025-01-14'],
      refreshedFor: null
    })
    expect(onHistory.nextDate).toBeNull()
    expect(onHistory.refreshDates).toBe(true)

    const alreadyKnown = followDate({
      ...base,
      current: '2025-01-13',
      today: '2025-01-16',
      liveDate: '2025-01-16',
      browsingHistory: true,
      knownDates: ['2025-01-16', '2025-01-15']
    })
    expect(alreadyKnown.nextDate).toBeNull()
    expect(alreadyKnown.refreshDates).toBe(false)
  })

  test('同一天不重复刷新', () => {
    expect(followDate(base)).toEqual({ nextDate: null, refreshDates: false })
    // 今天在列表里 → 不需要补拉
    expect(followDate({ ...base, refreshedFor: '2025-01-15' }).refreshDates).toBe(false)
  })

  test('今天缺文件时只补拉一次', () => {
    const first = followDate({ ...base, knownDates: ['2025-01-14'] })
    expect(first).toEqual({ nextDate: null, refreshDates: true })
    // 补拉之后即使列表里仍然没有今天（日文件还没建），也不再重拉
    const after = followDate({ ...base, knownDates: ['2025-01-14'], refreshedFor: '2025-01-15' })
    expect(after).toEqual({ nextDate: null, refreshDates: false })
  })

  test('实时日期不是今天时不跟随（时钟异常保护）', () => {
    const result = followDate({ ...base, current: '2025-01-15', liveDate: '2025-01-20', today: '2025-01-15' })
    expect(result).toEqual({ nextDate: null, refreshDates: false })
  })

  test('启动时今天不在列表里也不退回旧日期', () => {
    // 启动就把 current 定在今天（today），tick 只会补日期列表，不会切成昨天
    const result = followDate({
      ...base,
      current: '2025-01-16',
      today: '2025-01-16',
      liveDate: '2025-01-16',
      knownDates: ['2025-01-15', '2025-01-14']
    })
    expect(result.nextDate).toBeNull()
    expect(result.refreshDates).toBe(true)
  })
})
