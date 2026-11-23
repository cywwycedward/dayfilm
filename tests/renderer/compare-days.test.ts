import { describe, expect, test } from 'vitest'
import type { DayRollup, Scene, TopApp } from '../../src/shared/types'
import {
  axisTicks,
  compareDays,
  deltaDirection,
  formatDelta,
  unionRange
} from '../../src/renderer/src/lib/compare-days'
import { fmtMinutes, startOfDay } from '../../src/renderer/src/lib/time'

const HOUR = 3_600_000
const MINUTE = 60_000
const DATE = '2025-02-10'

function shot(id: string, exe: string, dayOffset: number, fromHour: number, minutes: number): Scene {
  const start = startOfDay(DATE) + dayOffset * 24 * HOUR + fromHour * HOUR
  return {
    id,
    start,
    end: start + minutes * MINUTE,
    exe,
    title: `${exe} 窗口`,
    seconds: minutes * 60,
    kind: 'shot'
  }
}

function day(date: string, scenes: Scene[], apps: TopApp[], cutRate: number): DayRollup {
  const first = scenes[0] ?? null
  const last = scenes[scenes.length - 1] ?? null
  return {
    date,
    firstAt: first?.start ?? null,
    lastAt: last?.end ?? null,
    activeMs: scenes.reduce((sum, scene) => sum + scene.seconds * 1000, 0),
    idleMs: 0,
    scenes,
    cuts: Math.max(0, scenes.length - 1),
    longestShot: scenes.reduce<Scene | null>(
      (best, scene) => (!best || scene.seconds > best.seconds ? scene : best),
      null
    ),
    topApps: apps,
    verdict: { label: '标准剪辑', note: `${date} 的点评。`, cutRate },
    featureMs: 0,
    extraMs: 0
  }
}

const leftScenes = [
  shot('l1', 'Code', 0, 9, 60),
  shot('l2', 'chrome', 0, 11, 30),
  shot('l3', 'Code', 0, 14, 30)
]
const rightScenes = [shot('r1', 'Code', -1, 10, 45)]
const left = day(DATE, leftScenes, [{ exe: 'Code', seconds: 5400 }, { exe: 'chrome', seconds: 1800 }], 1.5)
const right = day('2025-02-09', rightScenes, [{ exe: 'WeChat', seconds: 2700 }], 0)
const result = compareDays(left, right)

describe('compareDays 两侧有数据', () => {
  test('两侧都有读数：空状态与题材', () => {
    expect(result.left.empty).toBe(false)
    expect(result.right.empty).toBe(false)
    expect(result.left.genre).toBe('标准剪辑')
    expect(result.left.date).toBe(DATE)
    expect(result.right.date).toBe('2025-02-09')
  })

  test('差异列：活跃时长、镜头数、每小时剪辑，左减右', () => {
    expect(result.diff.map((item) => item.label)).toEqual(['活跃时长', '镜头数', '每小时剪辑'])
    const [active, shots, rate] = result.diff
    expect(active.unit).toBe('ms')
    expect(active.delta).toBe(2 * HOUR - 45 * MINUTE)
    expect(active.current).toBe('2 小时')
    expect(active.previous).toBe('45 分')
    expect(shots.delta).toBe(2)
    expect(shots.unit).toBe('count')
    expect(rate.delta).toBe(1.5)
    expect(rate.unit).toBe('rate')
  })

  test('差值文案只描述变化：正负带符号，单位跟指标走', () => {
    const [active, shots, rate] = result.diff
    expect(formatDelta(active)).toBe(`+${fmtMinutes(2 * HOUR - 45 * MINUTE)}`)
    expect(formatDelta(shots)).toBe('+2 个')
    expect(formatDelta(rate)).toBe('+1.5 次/小时')
    expect(deltaDirection(active)).toBe('up')
    expect(deltaDirection(shots)).toBe('up')
  })

  test('反向差值用银色的方向标', () => {
    const flipped = compareDays(right, left)
    expect(flipped.diff[0].delta !== null && flipped.diff[0].delta < 0).toBe(true)
    expect(formatDelta(flipped.diff[0]).startsWith('−')).toBe(true)
    expect(deltaDirection(flipped.diff[0])).toBe('down')
  })

  test('差值按分钟取整，与两侧读数对得上', () => {
    // 1:40:50 与 8:17:40 会分别显示为 1 小时 41 分 / 8 小时 18 分
    const messyLeft = day(DATE, [shot('m1', 'Code', 0, 9, 100.8333)], [], 0)
    const messyRight = day('2025-02-09', [shot('m2', 'Code', -1, 9, 497.6667)], [], 0)
    const messy = compareDays(messyLeft, messyRight)
    expect(messy.diff[0].current).toBe('1 小时 41 分')
    expect(messy.diff[0].previous).toBe('8 小时 18 分')
    expect(formatDelta(messy.diff[0])).toBe('−6 小时 37 分')
  })

  test('素材块是日内偏移，投影到并集范围后落在 0–1', () => {
    expect(result.left.blocks.length).toBe(3)
    expect(result.right.blocks.length).toBe(1)
    const range = result.range
    if (range === null) throw new Error('两侧都有数据时应有范围')
    const span = range.end - range.start
    for (const block of [...result.left.blocks, ...result.right.blocks]) {
      expect(block.start).toBeGreaterThanOrEqual(range.start)
      expect(block.end).toBeLessThanOrEqual(range.end)
      expect((block.start - range.start) / span).toBeGreaterThanOrEqual(0)
      expect((block.end - range.start) / span).toBeLessThanOrEqual(1)
      expect(Number.isFinite(block.hue)).toBe(true)
    }
    // 两天的镜头都换算成离各自零点的偏移
    expect(result.left.blocks[0].start).toBe(9 * HOUR)
    expect(result.right.blocks[0].start).toBe(10 * HOUR)
  })

  test('带子左侧的族色条取当天最长镜头的族色', () => {
    // 左侧最长是 Code 的 60 分钟；右侧唯一一镜也是 Code
    expect(result.left.hue).toBe(result.left.blocks[0].hue)
    expect(result.right.hue).toBe(result.right.blocks[0].hue)
  })
})

describe('unionRange', () => {
  test('两侧都有：取两个日内区间的并集', () => {
    // 左侧 09:00–14:30，右侧 10:00–10:45 → 并集 09:00–14:30
    expect(unionRange(left, right)).toEqual({ start: 9 * HOUR, end: 14.5 * HOUR })
  })

  test('任一侧为空：用另一侧的范围', () => {
    expect(unionRange(left, null)).toEqual({ start: 9 * HOUR, end: 14.5 * HOUR })
    expect(unionRange(null, right)).toEqual({ start: 10 * HOUR, end: 10.75 * HOUR })
  })

  test('两侧都空：null', () => {
    expect(unionRange(null, null)).toBeNull()
    expect(unionRange(day('2025-02-08', [], [], 0), null)).toBeNull()
  })

  test('两侧同一天：就是那天的范围', () => {
    expect(unionRange(left, left)).toEqual({ start: 9 * HOUR, end: 14.5 * HOUR })
  })
})

describe('axisTicks', () => {
  test('5 个刻度，首尾是范围两端，标签是日内时刻', () => {
    const range = unionRange(left, right)
    if (range === null) throw new Error('应有范围')
    const ticks = axisTicks(range)
    expect(ticks).toHaveLength(5)
    expect(ticks[0]).toEqual({ at: 9 * HOUR, label: '09:00' })
    expect(ticks[4]).toEqual({ at: 14.5 * HOUR, label: '14:30' })
    for (let index = 1; index < ticks.length; index += 1) {
      expect(ticks[index].at).toBeGreaterThan(ticks[index - 1].at)
    }
  })

  test('没有范围就没有刻度', () => {
    expect(axisTicks(null)).toEqual([])
  })
})

describe('compareDays 一侧为空', () => {
  const single = day(DATE, [shot('a', 'Code', 0, 9, 30)], [{ exe: 'Code', seconds: 1800 }], 0)
  const oneSided = compareDays(single, null)

  test('空侧给空状态，范围只用另一侧', () => {
    expect(oneSided.left.empty).toBe(false)
    expect(oneSided.right.empty).toBe(true)
    expect(oneSided.right.genre).toBe('')
    expect(oneSided.right.blocks).toEqual([])
    expect(oneSided.range).toEqual({ start: 9 * HOUR, end: 9.5 * HOUR })
  })

  test('任一侧无数据时差值都是 null，文案是 "—"', () => {
    for (const item of oneSided.diff) {
      expect(item.delta).toBeNull()
      expect(formatDelta(item)).toBe('—')
      expect(deltaDirection(item)).toBe('none')
    }
    expect(oneSided.diff[0].current).toBe('30 分')
    expect(oneSided.diff[0].previous).toBe('—')
  })

  test('两边都空也不报错', () => {
    const empty = compareDays(null, null)
    expect(empty.left.empty && empty.right.empty).toBe(true)
    expect(empty.diff.every((item) => item.delta === null)).toBe(true)
    expect(empty.range).toBeNull()
    expect(empty.ticks).toEqual([])
  })

  test('有日期但没有镜头的一天也算空侧', () => {
    const noShots = day('2025-02-08', [], [], 0)
    const mixed = compareDays(single, noShots)
    expect(mixed.right.empty).toBe(true)
    expect(mixed.diff[1].delta).toBeNull()
  })
})

describe('compareDays 完全相等', () => {
  const scenes = [shot('x', 'Code', 0, 9, 40), shot('y', 'chrome', 0, 10, 20)]
  const apps = [{ exe: 'Code', seconds: 2400 }]
  const a = day(DATE, scenes, apps, 2)
  const b = day(DATE, scenes, apps, 2)
  const same = compareDays(a, b)

  test('差值全是 0，文案"持平"，不上色', () => {
    for (const item of same.diff) {
      expect(item.delta).toBe(0)
      expect(formatDelta(item)).toBe('持平')
      expect(deltaDirection(item)).toBe('flat')
    }
  })

  test('两侧素材块与范围一致', () => {
    expect(same.left.blocks).toEqual(same.right.blocks)
    expect(same.range).toEqual({ start: 9 * HOUR, end: 10 * HOUR + 20 * MINUTE })
  })
})
