import { describe, expect, test } from 'vitest'
import type { DayRollup, Scene } from '../../src/shared/types'
import { buildWeek, dayBuckets, lastSevenDates } from '../../src/renderer/src/lib/week'
import { startOfDay } from '../../src/renderer/src/lib/time'

const DAY = '2025-01-15'
const HOUR = 3_600_000
const MINUTE = 60_000
const dayStart = startOfDay(DAY)

function scene(id: string, fromHour: number, minutes: number, kind: Scene['kind'] = 'shot'): Scene {
  const start = dayStart + fromHour * HOUR
  const end = start + minutes * MINUTE
  return { id, start, end, exe: 'Code', title: id, seconds: minutes * 60, kind }
}

function rollup(id: string, scenes: Scene[]): DayRollup {
  return {
    date: id,
    firstAt: scenes[0]?.start ?? null,
    lastAt: scenes[scenes.length - 1]?.end ?? null,
    activeMs: 0,
    featureMs: 0,
    extraMs: 0,
    idleMs: 0,
    scenes,
    cuts: 0,
    longestShot: null,
    topApps: [],
    verdict: { label: '标准剪辑', note: '', cutRate: 0 }
  }
}

describe('dayBuckets', () => {
  test('没有数据时是 24 个 0', () => {
    const buckets = dayBuckets(null)
    expect(buckets).toHaveLength(24)
    expect(buckets.every((value) => value === 0)).toBe(true)
  })

  test('半小时就点满一格', () => {
    const buckets = dayBuckets(rollup(DAY, [scene('a', 10, 30)]))
    expect(buckets[10]).toBeCloseTo(1, 6)
    expect(buckets[11]).toBe(0)
  })

  test('亮度随时长对数增长，不超过 1', () => {
    const short = dayBuckets(rollup(DAY, [scene('a', 10, 15)]))[10]
    const long = dayBuckets(rollup(DAY, [scene('a', 10, 30)]))[10]
    const longer = dayBuckets(rollup(DAY, [scene('a', 10, 60)]))[10]
    expect(short).toBeGreaterThan(0)
    expect(short).toBeLessThan(long)
    expect(long).toBeLessThanOrEqual(1)
    expect(longer).toBe(1)
    expect(Math.log1p(15) / Math.log1p(30)).toBeCloseTo(short, 6)
  })

  test('跨小时的镜头分到两个桶', () => {
    const buckets = dayBuckets(rollup(DAY, [scene('a', 10.75, 30)]))
    expect(buckets[10]).toBeGreaterThan(0)
    expect(buckets[11]).toBeGreaterThan(0)
    expect(buckets[12]).toBe(0)
  })

  test('中场休息不算活跃', () => {
    const buckets = dayBuckets(rollup(DAY, [scene('a', 10, 30, 'intermission')]))
    expect(buckets.every((value) => value === 0)).toBe(true)
  })
})

describe('buildWeek', () => {
  test('每格带日期、24 桶与今天标记', () => {
    const dates = lastSevenDates(DAY)
    const days = dates.map((date, index) => (index === 6 ? rollup(date, [scene('a', 12, 30)]) : null))
    const cells = buildWeek(dates, days, DAY)
    expect(cells).toHaveLength(7)
    expect(cells[6].isToday).toBe(true)
    expect(cells[5].isToday).toBe(false)
    expect(cells[6].hasData).toBe(true)
    expect(cells[6].buckets[12]).toBeCloseTo(1, 6)
    expect(cells[0].hasData).toBe(false)
    expect(cells[0].buckets.every((value) => value === 0)).toBe(true)
  })

  test('读取失败的天是空格，不影响其他天', () => {
    const dates = ['2025-01-13', '2025-01-14', '2025-01-15']
    const cells = buildWeek(dates, [null, rollup('2025-01-14', [scene('a', 9, 30)]), null], DAY)
    expect(cells.map((cell) => cell.hasData)).toEqual([false, true, false])
  })

  test('某个日期缺数据时不会抛错', () => {
    const cells = buildWeek(['2025-01-15'], [], DAY)
    expect(cells[0].hasData).toBe(false)
    expect(cells[0].buckets).toHaveLength(24)
  })
})

describe('lastSevenDates', () => {
  test('七天、从旧到新、以今天结尾', () => {
    const dates = lastSevenDates('2025-01-15')
    expect(dates).toHaveLength(7)
    expect(dates[0]).toBe('2025-01-09')
    expect(dates[6]).toBe('2025-01-15')
    expect([...dates].sort()).toEqual(dates)
  })

  test('跨月也连续', () => {
    expect(lastSevenDates('2025-03-02')).toEqual([
      '2025-02-24',
      '2025-02-25',
      '2025-02-26',
      '2025-02-27',
      '2025-02-28',
      '2025-03-01',
      '2025-03-02'
    ])
  })
})
