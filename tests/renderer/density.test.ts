import { describe, expect, test } from 'vitest'
import type { Scene } from '../../src/shared/types'
import {
  DENSITY_BUCKETS,
  DENSITY_BUCKET_MS,
  dayDensity,
  densityBars
} from '../../src/renderer/src/lib/density'
import { startOfDay } from '../../src/renderer/src/lib/time'

const DAY = '2026-11-22'
const dayStart = startOfDay(DAY)
const MINUTE = 60_000

function shot(id: string, fromMinute: number, minutes: number): Scene {
  const start = dayStart + fromMinute * MINUTE
  return { id, start, end: start + minutes * MINUTE, exe: 'Code', title: id, seconds: minutes * 60, kind: 'shot' }
}

function rest(id: string, fromMinute: number, minutes: number): Scene {
  const start = dayStart + fromMinute * MINUTE
  return { id, start, end: start + minutes * MINUTE, exe: '', title: '中场休息', seconds: minutes * 60, kind: 'intermission' }
}

describe('dayDensity', () => {
  test('一天切 144 桶，每桶 10 分钟', () => {
    expect(DENSITY_BUCKETS).toBe(144)
    expect(DENSITY_BUCKET_MS).toBe(600_000)
    expect(dayDensity([], dayStart)).toHaveLength(144)
  })

  test('空日全是 0', () => {
    const buckets = dayDensity([], dayStart)
    expect(buckets.every((level) => level === 0)).toBe(true)
  })

  test('正好填满一桶是 1', () => {
    const buckets = dayDensity([shot('a', 9 * 60, 10)], dayStart)
    expect(buckets[54]).toBe(1)
    expect(buckets.filter((level) => level > 0)).toHaveLength(1)
  })

  test('半桶是 0.5', () => {
    expect(dayDensity([shot('a', 9 * 60, 5)], dayStart)[54]).toBe(0.5)
  })

  test('跨桶的镜头分到两个桶', () => {
    const buckets = dayDensity([shot('a', 9 * 60 + 5, 10)], dayStart)
    expect(buckets[54]).toBeCloseTo(0.5, 6)
    expect(buckets[55]).toBeCloseTo(0.5, 6)
  })

  test('中场休息不算素材', () => {
    const buckets = dayDensity([rest('r', 12 * 60, 30)], dayStart)
    expect(buckets.every((level) => level === 0)).toBe(true)
  })

  test('越界的镜头被夹进当天，不越界写入', () => {
    const before: Scene = { ...shot('a', 0, 1), start: dayStart - 30 * MINUTE, end: dayStart + 5 * MINUTE }
    const after: Scene = { ...shot('b', 0, 1), start: dayStart + 23 * 3600_000 + 55 * MINUTE, end: dayStart + 25 * 3600_000 }
    const buckets = dayDensity([before, after], dayStart)
    expect(buckets).toHaveLength(144)
    expect(buckets[0]).toBeCloseTo(0.5, 6)
    expect(buckets[143]).toBeCloseTo(0.5, 6)
    expect(buckets.every((level) => level >= 0 && level <= 1)).toBe(true)
  })
})

describe('densityBars', () => {
  const buckets = dayDensity([shot('a', 9 * 60, 10), shot('b', 15 * 60, 5)], dayStart)

  test('全天视窗铺满宽度，桶数与数据一致', () => {
    const bars = densityBars(buckets, { startMs: dayStart, spanMs: 86_400_000 }, 1440, dayStart)
    expect(bars).toHaveLength(144)
    expect(bars[0].x0).toBe(0)
    expect(bars[143].x1).toBeCloseTo(1440, 6)
    expect(bars[54].level).toBe(1)
  })

  test('缩放后只返回可见的桶，坐标按视窗换算', () => {
    const view = { startMs: dayStart + 8 * 3600_000, spanMs: 4 * 3600_000 }
    const bars = densityBars(buckets, view, 800, dayStart)
    expect(bars.length).toBe(24)
    expect(bars[0].index).toBe(48)
    expect(bars[0].x0).toBe(0)
    expect(bars[bars.length - 1].x1).toBeCloseTo(800, 6)
  })

  test('空桶带 empty 标记', () => {
    const bars = densityBars(buckets, { startMs: dayStart, spanMs: 86_400_000 }, 1440, dayStart)
    expect(bars[0].empty).toBe(true)
    expect(bars[54].empty).toBe(false)
  })

  test('非法输入返回空数组', () => {
    expect(densityBars([], { startMs: dayStart, spanMs: 1000 }, 100, dayStart)).toEqual([])
    expect(densityBars(buckets, { startMs: dayStart, spanMs: 0 }, 100, dayStart)).toEqual([])
    expect(densityBars(buckets, { startMs: dayStart, spanMs: 1000 }, 0, dayStart)).toEqual([])
  })
})
