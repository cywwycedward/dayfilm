import { describe, expect, test } from 'vitest'
import type { DayRollup, LiveState, Scene } from '../../src/shared/types'
import {
  HUD_BAR_MAX,
  HUD_BAR_MIN,
  HUD_BAR_WIDTH,
  HUD_MINUTES,
  HUD_RHYTHM_WIDTH,
  fmtHudDuration,
  hudElapsedMs,
  hudLeaveMs,
  hudMood,
  hudView,
  rhythmBars,
  rhythmBuckets
} from '../../src/renderer/src/lib/hud'
import { startOfDay } from '../../src/renderer/src/lib/time'

const MINUTE = 60_000
const dayStart = startOfDay('2026-11-22')
const now = dayStart + 15 * 3_600_000

function shot(id: string, fromMinute: number, minutes: number): Scene {
  const start = dayStart + fromMinute * MINUTE
  return { id, start, end: start + minutes * MINUTE, exe: 'Code', title: id, seconds: minutes * 60, kind: 'shot' }
}

function rest(id: string, fromMinute: number, minutes: number): Scene {
  const start = dayStart + fromMinute * MINUTE
  return { id, start, end: start + minutes * MINUTE, exe: '', title: '中场休息', seconds: minutes * 60, kind: 'intermission' }
}

function day(scenes: Scene[]): DayRollup {
  return {
    date: '2026-11-22',
    firstAt: scenes[0]?.start ?? null,
    lastAt: scenes[scenes.length - 1]?.end ?? null,
    activeMs: scenes.reduce((sum, scene) => sum + (scene.end - scene.start), 0),
    idleMs: 0,
    scenes,
    cuts: 3,
    longestShot: null,
    topApps: [],
    verdict: { label: '跳切风暴', note: '', cutRate: 64.5 },    featureMs: 0,    extraMs: 0
  }
}

function live(scene: Scene | null, overrides: Partial<LiveState> = {}): LiveState {
  return {
    capturing: true,
    captureError: null,
    storageError: null,
    paused: false,
    now,
    scene,
    day: day([shot('a', 890, 5), shot('b', 895, 3)]),
    ...overrides
  }
}

describe('HUD 状态', () => {
  test('拍摄中', () => {
    expect(hudMood(live(shot('c', 899, 1)))).toBe('shooting')
  })

  test('scene 为空是空闲', () => {
    expect(hudMood(live(null))).toBe('idle')
  })

  test('暂停优先于空闲', () => {
    expect(hudMood(live(null, { paused: true }))).toBe('paused')
  })

  test('采集出错优先于一切', () => {
    expect(hudMood(live(null, { paused: true, captureError: '采样子进程已退出' }))).toBe('error')
  })
})

describe('秒表', () => {
  test('拍摄中按 now 算', () => {
    const scene = shot('c', 899, 1)
    expect(hudElapsedMs(live(scene), now)).toBe(now - scene.start)
  })

  test('空闲时大数字是离开时长，不是最后一镜', () => {
    expect(hudLeaveMs(live(null), now)).toBe(2 * MINUTE)
    expect(hudElapsedMs(live(null), now)).toBe(3 * MINUTE)
  })

  test('没有镜头时为 0', () => {
    expect(hudElapsedMs({ ...live(null), day: day([]) }, now)).toBe(0)
  })

  test('MM:SS 秒级格式', () => {
    expect(fmtHudDuration(0)).toBe('00:00')
    expect(fmtHudDuration(65_000)).toBe('01:05')
    expect(fmtHudDuration(601_000)).toBe('10:01')
    expect(fmtHudDuration(59 * 60_000 + 59_000)).toBe('59:59')
  })
})

describe('节奏柱', () => {
  test('30 根柱、每根 2px、铺满 328px', () => {
    const counts = new Array(HUD_MINUTES).fill(0)
    const bars = rhythmBars(counts)
    expect(bars).toHaveLength(30)
    expect(bars[0].x).toBe(0)
    expect(bars[0].w).toBe(HUD_BAR_WIDTH)
    expect(bars[29].x + bars[29].w).toBeCloseTo(HUD_RHYTHM_WIDTH, 6)
  })

  test('最近一分钟在最后一根，越近越靠右', () => {
    expect(rhythmBuckets([shot('x', 899.5, 1)], now)[29]).toBe(1)
    expect(rhythmBuckets([shot('x', 898.5, 1)], now)[28]).toBe(1)
    expect(rhythmBuckets([shot('x', 898.5, 1)], now)[29]).toBe(0)
  })

  test('同一分钟的多次剪辑累加', () => {
    const counts = rhythmBuckets([shot('x', 898.5, 1), shot('y', 898.7, 1)], now)
    expect(counts[28]).toBe(2)
  })

  test('30 分钟之外与中场休息都不算', () => {
    const counts = rhythmBuckets([shot('old', 860, 1), rest('r', 899, 1)], now)
    expect(counts.every((value) => value === 0)).toBe(true)
  })

  test('柱高按该分钟次数缩放，空分钟 1px，峰值 24px', () => {
    const bars = rhythmBars([0, 1, 2])
    expect(bars[0].height).toBe(HUD_BAR_MIN)
    expect(bars[2].height).toBe(HUD_BAR_MAX)
    expect(bars[1].height).toBeGreaterThan(HUD_BAR_MIN)
    expect(bars[1].height).toBeLessThan(HUD_BAR_MAX)
  })
})

describe('HUD 文案', () => {
  test('拍摄中：REC + 应用名 + 标题 + 今日三组', () => {
    const scene = shot('c', 899, 1)
    scene.exe = 'WindowsTerminal'
    scene.title = 'LZD-20250906UAB: dayfilm'
    const view = hudView(live(scene), now)
    expect(view).toMatchObject({
      mood: 'shooting',
      status: 'REC',
      exe: 'WindowsTerminal',
      title: 'LZD-20250906UAB: dayfilm',
      ticking: true
    })
    expect(view.today).toEqual({ shots: 2, cuts: 3, verdict: '跳切风暴' })
    expect(view.elapsedText).toBe('01:00')
    expect(view.elapsedPrefix).toBe('')
  })

  test('空闲：显示离开键盘，大数字是离开时长', () => {
    const view = hudView(live(null), now)
    expect(view).toMatchObject({
      mood: 'idle',
      status: '空闲',
      title: '离开键盘',
      ticking: false,
      elapsedPrefix: '离开',
      elapsedText: '02:00'
    })
  })

  test('暂停：状态已暂停，保留应用名与冻结的镜长', () => {
    const view = hudView(live(null, { paused: true }), now)
    expect(view).toMatchObject({
      mood: 'paused',
      status: '已暂停',
      ticking: false,
      exe: 'Code',
      elapsedPrefix: '',
      elapsedText: '03:00'
    })
  })

  test('出错：状态错误，标题行放错误摘要', () => {
    const view = hudView(live(null, { captureError: '采样子进程已退出（代码 1）' }), now)
    expect(view).toMatchObject({ mood: 'error', status: '错误', title: '采样子进程已退出（代码 1）' })
  })
})
