import { describe, expect, test } from 'vitest'
import type { DayRollup, Scene, TopApp } from '../../src/shared/types'
import { HIGHLIGHT_WINDOW_MS, pickHighlights } from '../../src/renderer/src/lib/highlights'
import { startOfDay } from '../../src/renderer/src/lib/time'

const DAY = '2025-01-15'
const HOUR = 3_600_000
const MINUTE = 60_000
const dayStart = startOfDay(DAY)

function shot(id: string, fromHour: number, minutes: number, exe = 'Code'): Scene {
  const start = dayStart + fromHour * HOUR
  return {
    id,
    start,
    end: start + minutes * MINUTE,
    exe,
    title: id,
    seconds: minutes * 60,
    kind: 'shot'
  }
}

function rollup(scenes: Scene[], topApps: TopApp[] = []): DayRollup {
  return {
    date: DAY,
    firstAt: scenes[0]?.start ?? null,
    lastAt: scenes[scenes.length - 1]?.end ?? null,
    activeMs: scenes.reduce((sum, scene) => sum + (scene.end - scene.start), 0),
    idleMs: 0,
    scenes,
    cuts: Math.max(0, scenes.length - 1),
    longestShot: scenes.reduce<Scene | null>((best, scene) => (!best || scene.seconds > best.seconds ? scene : best), null),
    topApps,
    verdict: { label: '标准剪辑', note: '', cutRate: 0 },
    featureMs: 0,
    extraMs: 0
  }
}

describe('pickHighlights', () => {
  test('空日三条高光都没有', () => {
    expect(pickHighlights(rollup([]))).toEqual({ longest: null, busiest: null, topApp: null })
  })

  test('只有中场休息也算空日', () => {
    const rest: Scene = { ...shot('rest', 12, 30), kind: 'intermission' }
    expect(pickHighlights(rollup([rest])).longest).toBeNull()
  })

  test('最长镜头取时长最大的一个', () => {
    const result = pickHighlights(rollup([shot('a', 9, 10), shot('b', 10, 30), shot('c', 11, 20)]))
    expect(result.longest?.id).toBe('b')
  })

  test('并列时取更早出现的那个', () => {
    const result = pickHighlights(rollup([shot('a', 9, 20), shot('b', 10, 20)]))
    expect(result.longest?.id).toBe('a')
  })

  test('最密 30 分钟窗口数窗口内的镜头数', () => {
    const result = pickHighlights(
      rollup([shot('a', 10, 5), shot('b', 10.1, 5), shot('c', 10.2, 5), shot('d', 11, 5)])
    )
    expect(result.busiest).not.toBeNull()
    expect(result.busiest?.start).toBe(dayStart + 10 * HOUR)
    expect(result.busiest?.shots).toBe(3)
    expect(result.busiest?.cuts).toBe(2)
    expect(result.busiest?.end).toBe(dayStart + 10 * HOUR + HIGHLIGHT_WINDOW_MS)
  })

  test('窗口边界：正好在第 30 分钟的镜头不算进来', () => {
    const result = pickHighlights(rollup([shot('a', 10, 5), shot('b', 10.5, 5)]))
    expect(result.busiest?.start).toBe(dayStart + 10 * HOUR)
    expect(result.busiest?.shots).toBe(1)
    expect(result.busiest?.cuts).toBe(0)
  })

  test('窗口内的剪辑次数是镜头数减一', () => {
    const result = pickHighlights(rollup([shot('a', 9, 4), shot('b', 9.1, 4)]))
    expect(result.busiest?.shots).toBe(2)
    expect(result.busiest?.cuts).toBe(1)
  })

  test('进程时长第一按 ms 求和', () => {
    const result = pickHighlights(
      rollup([shot('a', 9, 10, 'Code'), shot('b', 10, 5, 'chrome'), shot('c', 11, 20, 'Code')])
    )
    expect(result.topApp).toEqual({ exe: 'Code', ms: 30 * MINUTE })
  })

  test('进程并列时保留先出现的那个', () => {
    const result = pickHighlights(rollup([shot('a', 9, 10, 'chrome'), shot('b', 10, 10, 'Code')]))
    expect(result.topApp?.exe).toBe('chrome')
  })
})
