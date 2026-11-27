import { describe, expect, test } from 'vitest'
import { findDiscoveries } from '../../src/renderer/src/lib/discover'
import { startOfDay } from '../../src/renderer/src/lib/time'
import type { DayRollup, Scene, SceneMark } from '../../src/shared/types'

const DAY = '2026-11-22'
const HOUR = 3_600_000
const MINUTE = 60_000
const dayStart = startOfDay(DAY)

function shot(id: string, fromHour: number, minutes: number, title = id, exe = 'Code', mark?: SceneMark): Scene {
  const start = dayStart + fromHour * HOUR
  return {
    id,
    start,
    end: start + minutes * MINUTE,
    exe,
    title,
    seconds: minutes * 60,
    kind: 'shot',
    ...(mark ? { mark } : {})
  }
}

function rollup(scenes: Scene[]): DayRollup {
  const ms = scenes.reduce((sum, scene) => sum + (scene.end - scene.start), 0)
  return {
    date: DAY,
    firstAt: scenes[0]?.start ?? null,
    lastAt: scenes[scenes.length - 1]?.end ?? null,
    activeMs: ms,
    idleMs: 0,
    scenes,
    cuts: Math.max(0, scenes.length - 1),
    longestShot: null,
    topApps: [],
    verdict: { label: '标准剪辑', note: '', cutRate: 0 },
    featureMs: ms,
    extraMs: 0
  }
}

describe('findDiscoveries', () => {
  test('空日与单镜头日没有发现', () => {
    expect(findDiscoveries(rollup([]))).toEqual([])
    expect(findDiscoveries(rollup([shot('a', 9, 10)]))).toEqual([])
  })

  test('重返：同一实体隔开 90 分钟以上又出现', () => {
    const day = rollup([
      shot('a', 9, 30, 'edl.ts - dayfilm'),
      shot('b', 9.6, 10, 'other.ts'),
      shot('c', 9.9, 10, 'another.ts'),
      shot('d', 10.2, 10, 'third.ts'),
      shot('e', 12, 20, 'edl.ts - dayfilm')
    ])
    const [first] = findDiscoveries(day)
    expect(first.kind).toBe('return')
    expect(first.text).toContain('edl')
    expect(first.evidence).toEqual([day.scenes[0].start, day.scenes[4].start])
  })

  test('易位：上午与 12 点之后的主线不同', () => {
    const day = rollup([shot('a', 9, 40, 'index.ts', 'Code'), shot('b', 14, 40, 'docs', 'msedge')])
    const kinds = findDiscoveries(day).map((item) => item.kind)
    expect(kinds).toContain('switch')
    const item = findDiscoveries(day).find((entry) => entry.kind === 'switch')
    expect(item?.text).toContain('Code')
    expect(item?.text).toContain('msedge')
  })

  test('反复：同一窗口一天打开 4 次以上', () => {
    const day = rollup([
      shot('a', 9, 5, 'notes.md - dayfilm'),
      shot('b', 10, 5, 'notes.md - dayfilm'),
      shot('c', 11, 5, 'notes.md - dayfilm'),
      shot('d', 15, 5, 'notes.md - dayfilm')
    ])
    const kinds = findDiscoveries(day).map((item) => item.kind)
    expect(kinds).toContain('revisit')
  })

  test('深夜：20 点之后还有 30 分钟以上的镜头', () => {
    const day = rollup([shot('a', 9, 10), shot('b', 21, 45)])
    const late = findDiscoveries(day).find((item) => item.kind === 'late')
    expect(late?.text).toContain('45 分钟')
  })

  test('最多三条，且花絮不参与', () => {
    const day = rollup([
      shot('a', 9, 40, 'edl.ts - dayfilm'),
      shot('b', 10, 40, 'edl.ts - dayfilm'),
      shot('c', 12, 40, 'docs', 'msedge'),
      shot('d', 21, 40, 'edl.ts - dayfilm'),
      shot('x', 21.8, 5, 'chat', 'msedge', 'extra')
    ])
    const found = findDiscoveries(day)
    expect(found.length).toBeLessThanOrEqual(3)
    expect(found.every((item) => item.evidence.every((start) => day.scenes.some((scene) => scene.start === start)))).toBe(true)
  })

  test('同一份数据两次调用结果一致', () => {
    const day = rollup([shot('a', 9, 40, 'edl.ts - dayfilm'), shot('b', 13, 40, 'edl.ts - dayfilm')])
    expect(findDiscoveries(day)).toEqual(findDiscoveries(day))
  })

  // v4 P3 回归：新增「镜头之后」只是并存的一行，原有发现的条数、顺序与证据不变
  test('回归：上限、顺序与 evidence 不因 v4 新功能改变', () => {
    const day = rollup([
      shot('a', 9, 40, 'edl.ts - dayfilm', 'Code'),
      shot('b', 9.8, 5, 'other.ts', 'Code'),
      shot('c', 10, 5, 'another.ts', 'Code'),
      shot('d', 13, 40, 'edl.ts - dayfilm', 'msedge'),
      shot('e', 14, 40, 'notes.md - dayfilm', 'msedge'),
      shot('f', 14.8, 5, 'notes.md - dayfilm', 'msedge'),
      shot('g', 15, 5, 'notes.md - dayfilm', 'msedge'),
      shot('h', 16, 5, 'notes.md - dayfilm', 'msedge'),
      shot('i', 21, 40, 'night.ts', 'msedge')
    ])
    const found = findDiscoveries(day)
    expect(found).toHaveLength(3)
    expect(found.map((item) => item.kind)).toEqual(['return', 'switch', 'revisit'])
    expect(found.map((item) => item.evidence)).toEqual([
      [day.scenes[0].start, day.scenes[3].start],
      [day.scenes[3].start],
      [day.scenes[4].start, day.scenes[5].start, day.scenes[6].start]
    ])
  })
})
