import { describe, expect, test } from 'vitest'
import type { DayRollup, Scene } from '../../src/shared/types'
import { EDL_FPS, formatEdl, recordTimecode, sourceTimecode } from '../../src/renderer/src/lib/edl'
import { startOfDay } from '../../src/renderer/src/lib/time'

const MINUTE = 60_000
const dayStart = startOfDay('2026-11-22')

function shot(id: string, fromMinute: number, minutes: number, exe = 'WindowsTerminal', title = 'LZD-20250906UAB: not-my-app'): Scene {
  const start = dayStart + fromMinute * MINUTE
  return { id, start, end: start + minutes * MINUTE, exe, title, seconds: minutes * 60, kind: 'shot' }
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
    activeMs: 0,
    idleMs: 0,
    scenes,
    cuts: 0,
    longestShot: null,
    topApps: [],
    verdict: { label: '跳切风暴', note: '', cutRate: 0 }
  }
}

describe('时间码', () => {
  test('24fps 帧号上限 23', () => {
    expect(EDL_FPS).toBe(24)
    expect(sourceTimecode(dayStart + 999)).toBe('00:00:00:23')
    expect(sourceTimecode(dayStart + 500)).toBe('00:00:00:12')
  })

  test('素材时间码用墙钟', () => {
    expect(sourceTimecode(dayStart + 20 * 3_600_000 + 21 * MINUTE + 30_000)).toBe('20:21:30:00')
  })

  test('记录时间从 01:00:00:00 起', () => {
    expect(recordTimecode(0)).toBe('01:00:00:00')
    expect(recordTimecode(102_000)).toBe('01:01:42:00')
    expect(recordTimecode(90 * MINUTE)).toBe('02:30:00:00')
  })
})

describe('EDL 文本', () => {
  test('头部两行与空行', () => {
    const lines = formatEdl(day([])).split('\n')
    expect(lines[0]).toBe('TITLE: Dayfilm 2026-11-22')
    expect(lines[1]).toBe('FCM: NON-DROP FRAME')
  })

  test('只导出镜头，编号 001 起，附带片段名', () => {
    const edl = formatEdl(day([shot('a', 20 * 60 + 21, 2), rest('r', 20 * 60 + 30, 10), shot('b', 20 * 60 + 40, 1)]))
    const lines = edl.split('\n')
    expect(lines.filter((line) => /^\d{3}\s+AX/.test(line))).toHaveLength(2)
    expect(lines[3]).toContain('001  AX       V     C        ')
    expect(lines[4]).toBe('* FROM CLIP NAME: WindowsTerminal — LZD-20250906UAB: not-my-app')
    expect(lines[5]).toMatch(/^002  AX/)
    expect(edl).not.toContain('中场休息')
  })

  test('记录时间保留真实间隔', () => {
    const edl = formatEdl(day([shot('a', 20 * 60 + 21, 2), shot('b', 20 * 60 + 40, 1)]))
    const events = edl.split('\n').filter((line) => line.includes('AX'))
    const [first, second] = events.map((line) => line.trim().split(/\s+/).slice(4, 8))
    expect(first[2]).toBe('01:00:00:00')
    expect(first[3]).toBe('01:02:00:00')
    // 第二镜晚出现 19 分钟，记录时间也跟着留空档
    expect(second[2]).toBe('01:19:00:00')
    expect(second[3]).toBe('01:20:00:00')
  })

  test('空标题用未命名窗口', () => {
    const edl = formatEdl(day([shot('a', 20 * 60 + 21, 2, 'Code', '')]))
    expect(edl).toContain('* FROM CLIP NAME: Code — 未命名窗口')
  })

  test('素材时间码与镜头的实际起止一致', () => {
    const first = shot('a', 20 * 60 + 21, 2)
    const edl = formatEdl(day([first]))
    const event = edl.split('\n').find((line) => line.includes('AX')) ?? ''
    expect(event).toContain(sourceTimecode(first.start))
    expect(event).toContain(sourceTimecode(first.end))
  })
})
