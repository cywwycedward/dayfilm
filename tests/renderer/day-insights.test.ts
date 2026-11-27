import { describe, expect, test } from 'vitest'
import { afterLongestShot, longestIntermission } from '../../src/renderer/src/lib/day-insights'
import { startOfDay } from '../../src/renderer/src/lib/time'
import type { DayRollup, Scene } from '../../src/shared/types'

const DAY = '2026-11-22'
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const dayStart = startOfDay(DAY)

/** 当天 HH:MM 的时刻。 */
function at(hour: number, minute = 0): number {
  return dayStart + hour * HOUR + minute * MINUTE
}

function shot(id: string, from: number, minutes: number, title = id, exe = 'Code'): Scene {
  return {
    id,
    start: from,
    end: from + minutes * MINUTE,
    exe,
    title,
    seconds: minutes * 60,
    kind: 'shot'
  }
}

function rest(id: string, from: number, minutes: number): Scene {
  return {
    id,
    start: from,
    end: from + minutes * MINUTE,
    exe: 'Idle',
    title: '',
    seconds: minutes * 60,
    kind: 'intermission'
  }
}

function longestOf(scenes: Scene[]): Scene | null {
  let best: Scene | null = null
  for (const scene of scenes) {
    if (scene.kind !== 'shot') continue
    if (best === null || scene.end - scene.start > best.end - best.start) best = scene
  }
  return best
}

function rollup(scenes: Scene[], anchor?: Scene | null): DayRollup {
  const ms = scenes.reduce((sum, scene) => sum + (scene.end - scene.start), 0)
  return {
    date: DAY,
    firstAt: scenes[0]?.start ?? null,
    lastAt: scenes[scenes.length - 1]?.end ?? null,
    activeMs: ms,
    idleMs: 0,
    scenes,
    cuts: Math.max(0, scenes.length - 1),
    longestShot: anchor === undefined ? longestOf(scenes) : anchor,
    topApps: [],
    verdict: { label: '标准剪辑', note: '', cutRate: 0 },
    featureMs: ms,
    extraMs: 0
  }
}

describe('afterLongestShot', () => {
  test('15 分钟内按归一化标题分组计数、按次数排序', () => {
    const day = rollup([
      shot('anchor', at(14, 3), 15, 'day-insights.ts - Visual Studio Code'),
      shot('a', at(14, 20), 2, 'GitHub - Chrome', 'msedge'),
      shot('b', at(14, 22), 2, 'GitHub - Chrome', 'msedge'),
      shot('c', at(14, 25), 2, 'notes.md - Visual Studio Code'),
      // 一个持续 10 分钟的镜头只计 1 次
      shot('d', at(14, 27), 10, 'notes.md - Visual Studio Code'),
      shot('e', at(14, 30), 1, 'GitHub - Chrome', 'msedge'),
      shot('f', at(14, 31), 1, 'terminal', 'WindowsTerminal'),
      // 恰好落在 endAt + 15 分钟上：不算
      shot('edge', at(14, 33), 1, 'boundary')
    ])
    const after = afterLongestShot(day)
    expect(after?.endAt).toBe(at(14, 18))
    expect(after?.groups).toEqual([
      { name: 'GitHub', count: 3 },
      { name: 'notes.md', count: 2 },
      { name: 'terminal', count: 1 }
    ])
  })

  test('没有最长镜头或窗口内没有镜头时返回 null', () => {
    expect(afterLongestShot(rollup([shot('a', at(9, 0), 20)], null))).toBeNull()
    const onlyRest = rollup([shot('a', at(9, 0), 20), rest('r', at(9, 20), 10)])
    expect(afterLongestShot(onlyRest)).toBeNull()
  })
})

describe('longestIntermission', () => {
  test('回来还是同一个窗口：exe 与 title 都相同', () => {
    const day = rollup([
      shot('a', at(11, 0), 18, 'notes.md', 'Code'),
      rest('r', at(11, 18), 48),
      shot('b', at(12, 6), 14, 'notes.md', 'Code')
    ])
    expect(longestIntermission(day)).toEqual({
      start: at(11, 18),
      ms: 48 * MINUTE,
      outcome: 'returned',
      nextExe: null
    })
  })

  test('exe 相同但标题不同也算换了窗口', () => {
    const day = rollup([
      shot('a', at(11, 0), 18, 'notes.md', 'Code'),
      rest('r', at(11, 18), 48),
      shot('b', at(12, 6), 14, 'other.ts', 'Code')
    ])
    expect(longestIntermission(day)).toEqual({
      start: at(11, 18),
      ms: 48 * MINUTE,
      outcome: 'changed',
      nextExe: 'Code'
    })
  })

  test('换了进程：nextExe 取后一条的 exe', () => {
    const day = rollup([
      shot('a', at(11, 0), 18, 'notes.md', 'Code'),
      rest('r', at(11, 18), 48),
      shot('b', at(12, 6), 14, 'GitHub - Chrome', 'msedge')
    ])
    expect(longestIntermission(day)?.outcome).toBe('changed')
    expect(longestIntermission(day)?.nextExe).toBe('msedge')
  })

  test('后面没有镜头：unknown', () => {
    const day = rollup([shot('a', at(11, 0), 18, 'notes.md', 'Code'), rest('r', at(11, 18), 20)])
    expect(longestIntermission(day)).toEqual({
      start: at(11, 18),
      ms: 20 * MINUTE,
      outcome: 'unknown',
      nextExe: null
    })
  })

  test('取最长的一段，等长取更早的一段', () => {
    const day = rollup([
      shot('a', at(9, 0), 20, 'notes.md', 'Code'),
      rest('r1', at(9, 20), 20),
      shot('b', at(9, 40), 20, 'notes.md', 'Code'),
      rest('r2', at(15, 0), 20),
      shot('c', at(15, 20), 20, 'notes.md', 'Code'),
      rest('r3', at(16, 0), 10),
      shot('d', at(16, 10), 20, 'notes.md', 'Code')
    ])
    expect(longestIntermission(day)?.start).toBe(at(9, 20))
    expect(longestIntermission(day)?.ms).toBe(20 * MINUTE)
  })

  test('没有中场休息返回 null', () => {
    expect(longestIntermission(rollup([shot('a', at(9, 0), 20)]))).toBeNull()
    expect(longestIntermission(rollup([]))).toBeNull()
  })
})

describe('确定性', () => {
  test('同一份输入连续调用两次结果深度相等', () => {
    const day = rollup([
      shot('anchor', at(14, 3), 15, 'day-insights.ts - Visual Studio Code'),
      shot('a', at(14, 20), 2, 'GitHub - Chrome', 'msedge'),
      shot('b', at(14, 22), 2, 'GitHub - Chrome', 'msedge'),
      shot('c', at(14, 25), 2, 'notes.md - Visual Studio Code'),
      rest('r', at(15, 0), 30),
      shot('d', at(15, 30), 1, 'terminal', 'WindowsTerminal')
    ])
    expect(afterLongestShot(day)).toEqual(afterLongestShot(day))
    expect(longestIntermission(day)).toEqual(longestIntermission(day))
  })
})
