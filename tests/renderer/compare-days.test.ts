import { describe, expect, test } from 'vitest'
import type { DayRollup, Scene, TopApp } from '../../src/shared/types'
import { compareDays, deltaDirection, formatDelta } from '../../src/renderer/src/lib/compare-days'
import { fmtMinutes, isoDate, startOfDay } from '../../src/renderer/src/lib/time'

const HOUR = 3_600_000
const MINUTE = 60_000
const DATE = '2025-02-10'
const dayStart = startOfDay(DATE)

function shot(id: string, exe: string, fromHour: number, minutes: number): Scene {
  const start = dayStart + fromHour * HOUR
  return { id, start, end: start + minutes * MINUTE, exe, title: `${exe} 窗口`, seconds: minutes * 60, kind: 'shot' }
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
    verdict: { label: '标准剪辑', note: `${date} 的点评。`, cutRate }
  }
}

describe('compareDays 两侧有数据', () => {
  const leftScenes = [shot('l1', 'Code', 9, 60), shot('l2', 'chrome', 11, 30), shot('l3', 'Code', 14, 30)]
  const rightScenes = [shot('r1', 'Code', 10, 45)]
  const left = day(DATE, leftScenes, [{ exe: 'Code', seconds: 5400 }, { exe: 'chrome', seconds: 1800 }], 1.5)
  const right = day('2025-02-09', rightScenes, [{ exe: 'WeChat', seconds: 2700 }], 0)
  const result = compareDays(left, right)

  test('两侧都有读数：题材、点评、三项数字', () => {
    expect(result.left.empty).toBe(false)
    expect(result.right.empty).toBe(false)
    expect(result.left.genre).toBe('标准剪辑')
    expect(result.left.note).toContain(DATE)
    expect(result.left.metrics.map((item) => item.label)).toEqual(['活跃时长', '镜头', '剪辑'])
    expect(result.left.metrics.map((item) => item.value)).toEqual(['2 小时', '3', '2'])
    expect(result.right.metrics.map((item) => item.value)).toEqual(['45 分', '1', '0'])
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
    expect(active.delta !== null && active.delta > 0).toBe(true)
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
    const messyLeft = day(DATE, [shot('m1', 'Code', 9, 100.8333)], [], 0)
    const messyRight = day('2025-02-09', [shot('m2', 'Code', 9, 497.6667)], [], 0)
    const messy = compareDays(messyLeft, messyRight)
    expect(messy.diff[0].current).toBe('1 小时 41 分')
    expect(messy.diff[0].previous).toBe('8 小时 18 分')
    expect(formatDelta(messy.diff[0])).toBe('−6 小时 37 分')
  })

  test('素材区间带按各自首尾铺满 0–1', () => {
    expect(result.left.blocks.length).toBe(3)
    expect(result.left.blocks[0].from).toBe(0)
    expect(result.left.blocks[0].to).toBeCloseTo((60 * MINUTE) / (5.5 * HOUR), 6)
    const last = result.left.blocks[result.left.blocks.length - 1]
    expect(last.to).toBeCloseTo(1, 6)
    for (const block of result.left.blocks) {
      expect(block.from).toBeGreaterThanOrEqual(0)
      expect(block.to).toBeLessThanOrEqual(1)
      expect(Number.isFinite(block.hue)).toBe(true)
    }
    // 单镜头的一天铺满整条
    expect(result.right.blocks).toEqual([{ from: 0, to: 1, hue: result.right.blocks[0].hue }])
  })

  test('进程前 3 按时长倒序，带展示用时长', () => {
    expect(result.left.apps.map((app) => app.exe)).toEqual(['Code', 'chrome'])
    expect(result.left.apps[0].value).toBe('1 小时 30 分')
    expect(result.right.apps.map((app) => app.exe)).toEqual(['WeChat'])
  })
})

describe('compareDays 一侧为空', () => {
  const left = day(DATE, [shot('a', 'Code', 9, 30)], [{ exe: 'Code', seconds: 1800 }], 0)
  const result = compareDays(left, null)

  test('空侧给空状态，读数是 "—"', () => {
    expect(result.left.empty).toBe(false)
    expect(result.right.empty).toBe(true)
    expect(result.right.genre).toBe('')
    expect(result.right.metrics.map((item) => item.value)).toEqual(['—', '—', '—'])
    expect(result.right.blocks).toEqual([])
    expect(result.right.apps).toEqual([])
  })

  test('任一侧无数据时差值都是 null，文案是 "—"', () => {
    for (const item of result.diff) {
      expect(item.delta).toBeNull()
      expect(formatDelta(item)).toBe('—')
      expect(deltaDirection(item)).toBe('none')
    }
    expect(result.diff[0].current).toBe('30 分')
    expect(result.diff[0].previous).toBe('—')
  })

  test('两边都空也不报错', () => {
    const empty = compareDays(null, null)
    expect(empty.left.empty && empty.right.empty).toBe(true)
    expect(empty.diff.every((item) => item.delta === null)).toBe(true)
  })

  test('有日期但没有镜头的一天也算空侧', () => {
    const noShots = day('2025-02-08', [], [], 0)
    const result = compareDays(left, noShots)
    expect(result.right.empty).toBe(true)
    expect(result.diff[1].delta).toBeNull()
  })
})

describe('compareDays 完全相等', () => {
  const scenes = [shot('x', 'Code', 9, 40), shot('y', 'chrome', 10, 20)]
  const apps = [{ exe: 'Code', seconds: 2400 }]
  const a = day(DATE, scenes, apps, 2)
  const b = day(DATE, scenes, apps, 2)
  const result = compareDays(a, b)

  test('差值全是 0，文案"持平"，不上色', () => {
    for (const item of result.diff) {
      expect(item.delta).toBe(0)
      expect(formatDelta(item)).toBe('持平')
      expect(deltaDirection(item)).toBe('flat')
    }
  })

  test('两侧读数一致', () => {
    expect(result.left.metrics).toEqual(result.right.metrics)
    expect(result.left.blocks).toEqual(result.right.blocks)
    expect(result.left.date).toBe(isoDate(startOfDay(DATE)))
  })
})
