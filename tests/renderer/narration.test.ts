import { describe, expect, test } from 'vitest'
import type { DayRollup, Scene } from '../../src/shared/types'
import { pickNarration } from '../../src/renderer/src/lib/narration'
import { startOfDay } from '../../src/renderer/src/lib/time'

const MINUTE = 60_000
const dayStart = startOfDay('2026-11-22')

function shot(id: string, fromMinute: number, minutes: number): Scene {
  const start = dayStart + fromMinute * MINUTE
  return { id, start, end: start + minutes * MINUTE, exe: 'Code', title: id, seconds: minutes * 60, kind: 'shot' }
}

function day(scenes: Scene[]): DayRollup {
  return {
    date: '2026-11-22',
    firstAt: scenes[0]?.start ?? null,
    lastAt: scenes[scenes.length - 1]?.end ?? null,
    activeMs: 0,
    idleMs: 0,
    scenes,
    cuts: Math.max(0, scenes.length - 1),
    longestShot: scenes.reduce<Scene | null>((best, scene) => (!best || scene.seconds > best.seconds ? scene : best), null),
    topApps: [],
    verdict: { label: '跳切风暴', note: '', cutRate: 0 },    featureMs: 0,    extraMs: 0
  }
}

// 9:00 起 5 镜挤在半小时里（最密窗口）；11:40 一镜 40 分（最长）；12:40 收尾
const dense = [shot('a', 540, 5), shot('b', 544, 3), shot('c', 548, 2), shot('d', 552, 4), shot('e', 556, 5)]
const rollup = day([...dense, shot('f', 700, 40), shot('g', 760, 5)])

// 稀疏日：首镜 9:00（5 分）、11:40 一镜 30 分（最长）、12:40 普通、13:20 极短、15:00 最后一镜
const spaced = day([shot('a', 540, 5), shot('b', 700, 30), shot('c', 760, 5), shot('d', 800, 0.25), shot('e', 900, 5)])

describe('字幕旁白', () => {
  test('最长镜头优先：即使它也在密集窗口里', () => {
    const view = pickNarration(rollup, rollup.scenes[5], 6)
    expect(view).toEqual({ index: 6, text: '这一天最长的一条，你在这里待了 40 分钟。' })
  })

  test('密集窗口里的前 10 镜：30 分钟里切出去 N 次', () => {
    expect(pickNarration(rollup, rollup.scenes[0], 1)?.text).toBe('30 分钟里切出去 4 次。')
    expect(pickNarration(rollup, rollup.scenes[4], 5)?.text).toBe('30 分钟里切出去 4 次。')
  })

  test('第一镜不在密集窗口时用开场句', () => {
    expect(pickNarration(spaced, spaced.scenes[0], 1)?.text).toBe('这一天从这里开始。')
  })

  test('最后一镜用收尾句', () => {
    expect(pickNarration(spaced, spaced.scenes[4], 5)?.text).toBe('这一天的最后一次停在这里。')
  })

  test('普通镜头写停留分钟，至少 1 分钟', () => {
    expect(pickNarration(spaced, spaced.scenes[2], 3)?.text).toBe('停留 5 分钟。')
    expect(pickNarration(spaced, spaced.scenes[3], 4)?.text).toBe('停留 1 分钟。')
  })

  test('镜次用调用方给的序号，缺省时自己算', () => {
    expect(pickNarration(rollup, rollup.scenes[2], 3)?.index).toBe(3)
    expect(pickNarration(rollup, rollup.scenes[2], 0)?.index).toBe(3)
  })

  test('中场休息没有字幕', () => {
    const rest: Scene = { ...shot('r', 640, 30), exe: '', title: '中场休息', kind: 'intermission' }
    const withRest = day([...dense, rest])
    expect(pickNarration(withRest, rest, 6)).toBeNull()
  })

  test('空日没有字幕', () => {
    expect(pickNarration(day([]), shot('z', 540, 5), 1)).toBeNull()
  })

  test('确定性：同一镜头永远同一句', () => {
    expect(pickNarration(rollup, rollup.scenes[2], 3)).toEqual(pickNarration(rollup, rollup.scenes[2], 3))
  })
})
