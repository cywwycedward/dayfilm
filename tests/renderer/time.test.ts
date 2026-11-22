import { describe, expect, test } from 'vitest'
import {
  fmtClock,
  fmtDuration,
  fmtElapsed,
  fmtMinutes,
  fractionOfDay,
  isoDate,
  startOfDay
} from '../../src/renderer/src/lib/time'

const DAY = '2025-01-15'
const HOUR = 3_600_000
const dayStart = startOfDay(DAY)

describe('时间轴比例', () => {
  test('00:00 → 0，24:00 → 1，12:00 → 0.5', () => {
    expect(fractionOfDay(dayStart, dayStart)).toBe(0)
    expect(fractionOfDay(dayStart + 24 * HOUR, dayStart)).toBe(1)
    expect(fractionOfDay(dayStart + 12 * HOUR, dayStart)).toBeCloseTo(0.5, 10)
  })

  test('越界夹取到边界，非法输入不产生 NaN', () => {
    expect(fractionOfDay(dayStart - 1, dayStart)).toBe(0)
    expect(fractionOfDay(dayStart + 24 * HOUR + 1, dayStart)).toBe(1)
    expect(fractionOfDay(Number.NaN, dayStart)).toBe(0)
    expect(fractionOfDay(dayStart, Number.NaN)).toBe(0)
  })
})

describe('日期与零点', () => {
  test('日期字符串与零点互逆', () => {
    expect(isoDate(dayStart)).toBe(DAY)
    expect(isoDate(startOfDay('2024-12-31'))).toBe('2024-12-31')
  })

  test('非法日期退化为 0，不抛出', () => {
    expect(startOfDay('bad')).toBe(0)
    expect(Number.isFinite(startOfDay('2025-01-15'))).toBe(true)
  })
})

describe('时长格式化', () => {
  test('分钟以内按秒', () => {
    expect(fmtDuration(0)).toBe('0 秒')
    expect(fmtDuration(42)).toBe('42 秒')
  })

  test('分钟与小时', () => {
    expect(fmtDuration(60)).toBe('1 分')
    expect(fmtDuration(65)).toBe('1 分 05 秒')
    expect(fmtDuration(180)).toBe('3 分')
    expect(fmtDuration(4320)).toBe('1 小时 12 分')
    expect(fmtDuration(3600)).toBe('1 小时')
  })

  test('非法与负值不产生 NaN', () => {
    expect(fmtDuration(Number.NaN)).toBe('0 秒')
    expect(fmtDuration(-5)).toBe('0 秒')
    expect(fmtDuration(Number.POSITIVE_INFINITY)).toBe('0 秒')
  })

  test('汇总时长', () => {
    expect(fmtMinutes(0)).toBe('0 分')
    expect(fmtMinutes(45 * 60_000)).toBe('45 分')
    expect(fmtMinutes(6.2 * HOUR)).toBe('6 小时 12 分')
    expect(fmtMinutes(Number.NaN)).toBe('0 分')
    expect(fmtMinutes(-1)).toBe('0 分')
  })

  test('有时长就至少报 1 分钟（与主进程剧本同口径）', () => {
    // 真实数据里的典型场景：4 秒活跃时长曾被显示为 "0 分"，同时又有 1 个镜头
    expect(fmtMinutes(4_000)).toBe('1 分')
    expect(fmtMinutes(1)).toBe('1 分')
    expect(fmtMinutes(29_000)).toBe('1 分')
    expect(fmtMinutes(30_000)).toBe('1 分')
    expect(fmtMinutes(89_000)).toBe('1 分')
    expect(fmtMinutes(90_000)).toBe('2 分')
    // 进程排行行同一口径：几秒的进程也报 1 分，而不是 0 分
    expect(fmtMinutes(4 * 1000)).toBe('1 分')
    expect(fmtMinutes(59 * 60_000)).toBe('59 分')
    expect(fmtMinutes(60 * 60_000)).toBe('1 小时')
  })

  test('计时器样式', () => {
    expect(fmtElapsed(0)).toBe('00:00:00')
    expect(fmtElapsed((2 * 3600 + 7 * 60 + 41) * 1000)).toBe('02:07:41')
    expect(fmtElapsed(125 * HOUR)).toBe('125:00:00')
    expect(fmtElapsed(Number.NaN)).toBe('00:00:00')
  })
})

describe('时刻格式化', () => {
  test('HH:MM，补零', () => {
    expect(fmtClock(new Date(2025, 0, 15, 7, 5, 9).getTime())).toBe('07:05')
    expect(fmtClock(new Date(2025, 0, 15, 23, 59).getTime())).toBe('23:59')
  })

  test('非法输入给出占位符', () => {
    expect(fmtClock(Number.NaN)).toBe('--:--')
  })
})
