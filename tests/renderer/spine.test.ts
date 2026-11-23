import { describe, expect, test } from 'vitest'
import type { DayRollup, Scene } from '../../src/shared/types'
import {
  SPINE_FRAME_H,
  SPINE_FRAME_MS,
  SPINE_FRAMES,
  densityLevel,
  spineFrameIndex,
  spineFrames,
  spineHeight,
  spineScrollTop,
  visibleSpineFrames
} from '../../src/renderer/src/lib/spine'
import { startOfDay } from '../../src/renderer/src/lib/time'

const DATE = '2025-03-04'
const DAY = startOfDay(DATE)
const MINUTE = 60_000

function scene(id: string, fromMinute: number, minutes: number, kind: 'shot' | 'intermission' = 'shot'): Scene {
  const start = DAY + fromMinute * MINUTE
  return {
    id,
    start,
    end: start + minutes * MINUTE,
    exe: 'Code',
    title: `窗口 ${id}`,
    seconds: minutes * 60,
    kind
  }
}

function day(scenes: Scene[]): DayRollup {
  return {
    date: DATE,
    firstAt: scenes[0]?.start ?? null,
    lastAt: scenes[scenes.length - 1]?.end ?? null,
    activeMs: scenes.filter((s) => s.kind === 'shot').reduce((sum, s) => sum + s.seconds * 1000, 0),
    idleMs: 0,
    scenes,
    cuts: Math.max(0, scenes.length - 1),
    longestShot: scenes[0] ?? null,
    topApps: [],
    verdict: { label: '标准剪辑', note: '', cutRate: 0 }
  }
}

describe('胶片脊柱的帧', () => {
  const rollup = day([
    scene('a', 9 * 60, 25), // 09:00–09:25 → 帧 54 / 55
    scene('b', 9 * 60 + 30, 5), // 09:30–09:35 → 帧 57
    scene('c', 10 * 60, 30, 'intermission'), // 中场休息不算素材
    scene('d', 23 * 60 + 55, 8) // 23:55–24:03 → 帧 143（夹在当天）
  ])

  test('144 帧，从 00:00 起每帧 10 分钟，整条 4608px', () => {
    const frames = spineFrames(rollup)
    expect(frames).toHaveLength(SPINE_FRAMES)
    expect(spineHeight()).toBe(SPINE_FRAMES * SPINE_FRAME_H)
    expect(spineHeight()).toBe(4608)
    expect(frames[0]).toMatchObject({ start: DAY, end: DAY + SPINE_FRAME_MS })
    expect(frames[143].start).toBe(DAY + 143 * SPINE_FRAME_MS)
    expect(frames[143].end).toBe(DAY + 24 * 60 * MINUTE)
  })

  test('每帧 6 个 100 秒密度小格', () => {
    const frames = spineFrames(rollup)
    expect(frames[0].levels).toHaveLength(6)
    // 09:00–09:10 全在镜头 a 里 → 6 格都满
    expect(frames[54].levels.every((level) => level === 1)).toBe(true)
    // 09:30–09:35 的镜头 b：前 3 格满（300 秒），后 3 格空
    expect(frames[57].levels.slice(0, 3).every((level) => level === 1)).toBe(true)
    expect(frames[57].levels.slice(3).every((level) => level === 0)).toBe(true)
  })

  test('每帧取该时段最长的镜头，跨帧按切片算活跃时长', () => {
    const frames = spineFrames(rollup)
    const frame54 = frames[54] // 09:00–09:10 全在镜头 a 里
    const frame55 = frames[55] // 09:10–09:20 也全在 a 里
    const frame57 = frames[57] // 09:30–09:35 → 5 分钟
    expect(frame54.scene?.id).toBe('a')
    expect(frame54.activeMs).toBe(10 * MINUTE)
    expect(frame55.scene?.id).toBe('a')
    expect(frame57.scene?.id).toBe('b')
    expect(frame57.activeMs).toBe(5 * MINUTE)
    // 跨帧的镜头：09:25 之后没有素材，帧 56 里只有 09:20–09:25
    expect(frames[56].activeMs).toBe(5 * MINUTE)
    expect(frames[56].scene?.id).toBe('a')
  })

  test('中场休息不算素材，空帧没有族色', () => {
    const frames = spineFrames(rollup)
    expect(frames[60].activeMs).toBe(0) // 10:00–10:10 是 intermission
    expect(frames[60].scene).toBeNull()
    expect(frames[60].hue).toBeNull()
  })

  test('23:55 的镜头落进最后一帧，不会被 24:00 截掉', () => {
    const frames = spineFrames(rollup)
    expect(frames[143].scene?.id).toBe('d')
    expect(frames[143].activeMs).toBe(5 * MINUTE) // 只算到 24:00
  })

  test('空的一天：144 帧全空', () => {
    const frames = spineFrames(day([]))
    expect(frames).toHaveLength(SPINE_FRAMES)
    expect(frames.every((frame) => frame.scene === null && frame.activeMs === 0)).toBe(true)
  })
})

describe('脊柱的定位与虚拟化', () => {
  test('时刻 → 帧序号，越界夹到首尾', () => {
    expect(spineFrameIndex(DAY, DATE)).toBe(0)
    expect(spineFrameIndex(DAY + 9 * 60 * MINUTE, DATE)).toBe(54)
    expect(spineFrameIndex(DAY + 24 * 60 * MINUTE, DATE)).toBe(143)
    expect(spineFrameIndex(DAY - 60 * MINUTE, DATE)).toBe(0)
  })

  test('可见范围只覆盖视口并多留一帧', () => {
    expect(visibleSpineFrames(0, 480)).toEqual({ start: 0, end: 16 })
    const middle = visibleSpineFrames(1000, 240)
    expect(middle.start).toBe(Math.floor(1000 / SPINE_FRAME_H) - 1)
    expect(middle.end).toBe(Math.ceil((1000 + 240) / SPINE_FRAME_H) + 1)
    // 滚到底也不越界
    expect(visibleSpineFrames(4608, 480)).toEqual({ start: 143, end: 144 })
  })

  test('滚动位置把时刻放在视口中间', () => {
    const top = spineScrollTop(DAY + 9 * 60 * MINUTE, DATE, 480)
    expect(top).toBe(Math.round((54 + 0.5) * SPINE_FRAME_H - 240))
    expect(spineScrollTop(DAY, DATE, 480)).toBe(0)
  })

  test('密度柱按平方根映射，满 100 秒到顶', () => {
    expect(densityLevel(0)).toBe(0)
    expect(densityLevel(100_000)).toBe(1)
    expect(densityLevel(25_000)).toBeCloseTo(0.5, 6)
  })
})
