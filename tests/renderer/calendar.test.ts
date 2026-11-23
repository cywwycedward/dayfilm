import { describe, expect, test } from 'vitest'
import {
  CALENDAR_DAYS,
  GENRE_PALETTE,
  NO_RECORD_PALETTE,
  calendarCells,
  calendarDates,
  cellPalette,
  type CalendarDay
} from '../../src/renderer/src/lib/calendar'
import { isoDate, startOfDay } from '../../src/renderer/src/lib/time'

const HOUR = 3_600_000
/** 2025-03-05 是周三，本周一是 03-03 */
const TODAY = '2025-03-05'

function day(date: string, activeMs: number, genre = '标准剪辑', shots = 3): CalendarDay {
  return { date, activeMs, genre, shots }
}

function nextDate(date: string): string {
  const value = new Date(startOfDay(date))
  value.setDate(value.getDate() + 1)
  return isoDate(value.getTime())
}

describe('片场日历周对齐', () => {
  test('84 格，从周一开始，7 行 × 12 列', () => {
    const dates = calendarDates(TODAY)
    expect(dates).toHaveLength(CALENDAR_DAYS)
    // 2024-12-16 是周一，最后一天是本周周日 2025-03-09
    expect(dates[0]).toBe('2024-12-16')
    expect(dates[CALENDAR_DAYS - 1]).toBe('2025-03-09')
    const cells = calendarCells(new Map(), TODAY)
    expect(cells).toHaveLength(CALENDAR_DAYS)
    cells.forEach((cell, index) => {
      expect(cell.dow).toBe(index % 7)
    })
  })

  test('今天在最后一行，之后的天标 future', () => {
    const cells = calendarCells(new Map(), TODAY)
    const index = cells.findIndex((cell) => cell.date === TODAY)
    expect(index).toBeGreaterThanOrEqual(CALENDAR_DAYS - 7)
    expect(cells[index].future).toBe(false)
    expect(cells.slice(index + 1).every((cell) => cell.future)).toBe(true)
    expect(cells.slice(0, index).every((cell) => !cell.future)).toBe(true)
  })
})

describe('片场日历跨月与缺日', () => {
  test('跨月连续，没有断档或重复', () => {
    const dates = calendarDates(TODAY)
    for (let index = 1; index < dates.length; index += 1) {
      expect(dates[index]).toBe(nextDate(dates[index - 1]))
    }
    // 窗口从 2024 年 12 月跨到 2025 年 3 月
    expect(dates).toContain('2024-12-31')
    expect(dates).toContain('2025-01-01')
    expect(dates).toContain('2025-03-01')
    expect(new Set(dates).size).toBe(CALENDAR_DAYS)
  })

  test('缺失日期按 0 处理，不抛错', () => {
    const days = new Map<string, CalendarDay>([['2025-03-04', day('2025-03-04', 2 * HOUR)]])
    const cells = calendarCells(days, TODAY)
    const filled = cells.find((cell) => cell.date === '2025-03-04')
    const missing = cells.find((cell) => cell.date === '2025-03-03')
    expect(filled).toMatchObject({ activeMs: 2 * HOUR, genre: '标准剪辑', shots: 3 })
    expect(filled?.level).toBeCloseTo(0.82, 6)
    expect(missing).toMatchObject({ activeMs: 0, genre: '', shots: 0, level: 0 })
  })

  test('空数据：84 格全是 0 级，未来格照旧标出', () => {
    const cells = calendarCells(new Map(), TODAY)
    expect(cells).toHaveLength(CALENDAR_DAYS)
    expect(cells.every((cell) => cell.level === 0 && cell.activeMs === 0)).toBe(true)
    expect(cells.some((cell) => cell.future)).toBe(true)
  })
})

describe('片场日历题材色相（A 块）', () => {
  test('无记录与四种题材的 H/S/B', () => {
    expect(cellPalette('', 0)).toEqual(NO_RECORD_PALETTE)
    expect(NO_RECORD_PALETTE).toEqual({ hue: 0, sat: 0, lum: 8 })
    expect(GENRE_PALETTE['长镜头']).toEqual({ hue: 200, sat: 35, lum: 55 })
    expect(GENRE_PALETTE['标准剪辑']).toEqual({ hue: 45, sat: 8, lum: 58 })
    expect(GENRE_PALETTE['快切']).toEqual({ hue: 48, sat: 38, lum: 68 })
    expect(GENRE_PALETTE['跳切风暴']).toEqual({ hue: 30, sat: 62, lum: 82 })
  })

  test('亮度在题材基色上随活跃度微调', () => {
    const low = cellPalette('长镜头', 0.2)
    const high = cellPalette('长镜头', 1)
    expect(high.lum).toBeGreaterThan(low.lum)
    expect(Math.abs(high.lum - 55)).toBeLessThanOrEqual(6)
    expect(Math.abs(low.lum - 55)).toBeLessThanOrEqual(6)
  })

  test('格子带上题材色相，未知题材回落标准剪辑', () => {
    const days = new Map<string, CalendarDay>([
      ['2025-03-04', day('2025-03-04', 2 * HOUR, '长镜头')],
      ['2025-03-03', day('2025-03-03', 1 * HOUR, '未知题材')]
    ])
    const cells = calendarCells(days, TODAY)
    expect(cells.find((cell) => cell.date === '2025-03-04')).toMatchObject({ hue: 200, sat: 35 })
    expect(cells.find((cell) => cell.date === '2025-03-03')).toMatchObject({ hue: 45, sat: 8 })
    expect(cells.find((cell) => cell.date === '2025-03-05')).toMatchObject({ hue: 0, sat: 0, lum: 8 })
  })
})

describe('片场日历色阶', () => {
  test('按活跃时长平方根映射到 18%–82%', () => {
    const days = new Map<string, CalendarDay>([
      ['2025-03-03', day('2025-03-03', 4 * HOUR)],
      ['2025-03-04', day('2025-03-04', 1 * HOUR)],
      ['2025-03-05', day('2025-03-05', 0, '', 0)]
    ])
    const cells = calendarCells(days, TODAY)
    const peak = cells.find((cell) => cell.date === '2025-03-03')
    const quarter = cells.find((cell) => cell.date === '2025-03-04')
    const silent = cells.find((cell) => cell.date === '2025-03-05')
    expect(peak?.level).toBeCloseTo(0.82, 6)
    // sqrt(1/4) = 0.5 → 0.18 + 0.64 × 0.5
    expect(quarter?.level).toBeCloseTo(0.5, 6)
    expect(silent?.level).toBe(0)
  })
})
