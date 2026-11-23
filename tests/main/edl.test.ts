import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEdlDate, renderEdl, timecode, writeEdlFile } from '../../src/main/edl'
import type { DayRollup, Scene } from '../../src/shared/types'

const DATE = '2026-11-22'
/** 本地时间 20:21:30.000 */
const START = new Date(2026, 10, 22, 20, 21, 30, 0).getTime()

function scene(startMs: number, endMs: number, exe = 'WindowsTerminal', title = 'LZD-20250906UAB: not-my-app', mark?: 'feature' | 'extra'): Scene {
  return {
    id: `${DATE}-x`,
    start: START + startMs,
    end: START + endMs,
    exe,
    title,
    seconds: Math.round((endMs - startMs) / 1000),
    kind: 'shot',
    ...(mark ? { mark } : {})
  }
}

function day(scenes: Scene[]): DayRollup {
  return {
    date: DATE,
    firstAt: scenes.length > 0 ? scenes[0].start : null,
    lastAt: scenes.length > 0 ? scenes[scenes.length - 1].end : null,
    activeMs: 0,
    idleMs: 0,
    scenes,
    cuts: 0,
    longestShot: null,
    topApps: [],
    verdict: { label: '长镜头', note: '', cutRate: 0 },
    featureMs: 0,
    extraMs: 0
  }
}

describe('timecode', () => {
  it('毫秒 → HH:MM:SS:FF，帧向上取整', () => {
    expect(timecode(0)).toBe('00:00:00:00')
    // 999ms = 23.976 帧 → 向上取整到 24 帧 = 1 秒 0 帧
    expect(timecode(999)).toBe('00:00:01:00')
    // 59.999s = 1439.976 帧 → 1440 帧 = 1 分 0 秒 0 帧
    expect(timecode(59_999)).toBe('00:01:00:00')
    expect(timecode(1000)).toBe('00:00:01:00')
    expect(timecode(125)).toBe('00:00:00:03')
    expect(timecode(3_600_000)).toBe('01:00:00:00')
    expect(timecode(3_723_000)).toBe('01:02:03:00')
    // 20:21:30.000 距零点
    expect(timecode(20 * 3_600_000 + 21 * 60_000 + 30_000)).toBe('20:21:30:00')
  })

  it('跨小时不丢进位的秒', () => {
    expect(timecode(59 * 60_000 + 59_500)).toBe('00:59:59:12')
    // 3599999ms = 86400 帧（向上取整），正好满一小时；帧号只能是 0–23
    expect(timecode(3_599_999)).toBe('01:00:00:00')
  })
})

describe('parseEdlDate', () => {
  it('合法日期原样返回，非法返回 null', () => {
    expect(parseEdlDate('2026-11-22')).toBe('2026-11-22')
    expect(parseEdlDate('yesterday')).toBeNull()
    expect(parseEdlDate('2026-1-2')).toBeNull()
    expect(parseEdlDate(20261122)).toBeNull()
    expect(parseEdlDate(undefined)).toBeNull()
  })
})

describe('renderEdl', () => {
  it('按 CMX3600 列宽输出事件与 clip name，记录轨从 01:00:00:00 起', () => {
    const text = renderEdl(day([scene(0, 102_000)]))
    const lines = text.trimEnd().split('\n')
    expect(lines[0]).toBe('TITLE: Dayfilm 2026-11-22')
    expect(lines[1]).toBe('FCM: NON-DROP FRAME')
    expect(lines[2]).toBe('')
    // 20:21:30.000 → 20:23:12.000（1 分 42 秒），记录轨 01:00:00:00 → 01:01:42:00
    expect(lines[3]).toBe('001  AX       V     C        20:21:30:00 20:23:12:00 01:00:00:00 01:01:42:00')
    expect(lines[4]).toBe('* FROM CLIP NAME: WindowsTerminal - LZD-20250906UAB: not-my-app')
    // 分隔符必须是 ASCII：全角破折号在旧剪辑软件里容易变成乱码
    expect(lines[4]).not.toContain('—')
    expect(text).not.toContain('—')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('事件编号递增，记录轨保留真实间隔', () => {
    // 第一镜 0–10s，休息 5 分钟，第二镜 5min–5min20s
    const text = renderEdl(day([scene(0, 10_000), scene(300_000, 320_000, 'Code', 'dayfilm')]))
    const lines = text.trimEnd().split('\n').filter((line) => !line.startsWith('*'))
    expect(lines[3]).toBe('001  AX       V     C        20:21:30:00 20:21:40:00 01:00:00:00 01:00:10:00')
    // 记录轨：01:00:00:00 + 300s = 01:05:00:00
    expect(lines[4]).toBe('002  AX       V     C        20:26:30:00 20:26:50:00 01:05:00:00 01:05:20:00')
  })

  it('跳过中场休息镜头', () => {
    const intermission: Scene = {
      id: `${DATE}-2`,
      start: START + 10_000,
      end: START + 190_000,
      exe: '',
      title: '',
      seconds: 180,
      kind: 'intermission'
    }
    const text = renderEdl(day([scene(0, 10_000), intermission, scene(190_000, 200_000, 'Code', 'dayfilm')]))
    const events = text.split('\n').filter((line) => /^\d{3}  /.test(line))
    expect(events).toHaveLength(2)
    expect(events[1].startsWith('002  ')).toBe(true)
    expect(text).not.toContain('中场休息')
  })

  it('空标题写"未命名窗口"，换行被压平', () => {
    const text = renderEdl(day([scene(0, 10_000, 'Code', '   '), scene(10_000, 20_000, 'Code', 'a\nb')]))
    expect(text).toContain('* FROM CLIP NAME: Code - 未命名窗口')
    expect(text).toContain('* FROM CLIP NAME: Code - a b')
  })

  it('跨小时的时间码', () => {
    const late = new Date(2026, 10, 22, 23, 59, 30, 0).getTime()
    const sceneLate: Scene = {
      id: `${DATE}-9`,
      start: late,
      end: late + 60_000,
      exe: 'Code',
      title: 'dayfilm',
      seconds: 60,
      kind: 'shot'
    }
    const text = renderEdl({
      ...day([sceneLate]),
      firstAt: late,
      lastAt: late + 60_000
    })
    expect(text).toContain('23:59:30:00 00:00:30:00 01:00:00:00 01:01:00:00')
  })

  it('没有镜头时只有头部', () => {
    expect(renderEdl(day([]))).toBe('TITLE: Dayfilm 2026-11-22\nFCM: NON-DROP FRAME\n\n')
  })
})

describe('writeEdlFile', () => {
  const roots: string[] = []

  function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'dayfilm-edl-'))
    roots.push(root)
    return root
  }

  afterEach(() => {
    while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true })
  })

  it('写盘成功，内容是 UTF-8 的 CMX3600', async () => {
    const target = join(tempRoot(), 'dayfilm-2026-11-22.edl')
    await writeEdlFile(target, day([scene(0, 102_000)]))
    const text = readFileSync(target, 'utf8')
    expect(text.startsWith('TITLE: Dayfilm 2026-11-22\nFCM: NON-DROP FRAME\n')).toBe(true)
    expect(text).toContain('* FROM CLIP NAME: WindowsTerminal - LZD-20250906UAB: not-my-app')
  })

  it('目标不可写时报可读错误，不会静默，也不留半个文件', async () => {
    const root = tempRoot()
    // 把目录本身当作目标：写入必定失败
    await expect(writeEdlFile(root, day([scene(0, 10_000)]))).rejects.toThrow(/^EDL 保存失败：/)
    await expect(writeEdlFile(root, day([scene(0, 10_000)]))).rejects.toThrow(
      /没有写入权限|目标是一个文件夹|文件被其他程序占用|未知错误/
    )
    // 错误文案不带路径（不泄路径、也不靠它才能看懂）
    await expect(writeEdlFile(root, day([scene(0, 10_000)]))).rejects.not.toThrow(root)
    expect(readdirSync(root)).toEqual([])
  })

  it('目标是一个不存在的盘符时也报可读错误', async () => {
    const target = join(tempRoot(), '不存在的子目录', 'dayfilm.edl')
    await expect(writeEdlFile(target, day([scene(0, 10_000)]))).rejects.toThrow(/EDL 保存失败：/)
  })
})

describe('renderEdl 花絮（v2.4）', () => {
  it('只导出非花絮镜头，头部加注释行', () => {
    const text = renderEdl(
      day([
        scene(0, 60_000, 'Code', 'dayfilm', 'feature'),
        scene(60_000, 120_000, 'Slack', '#general', 'extra'),
        scene(120_000, 180_000, 'Chrome', 'GitHub')
      ])
    )
    const events = text.split('\n').filter((line) => /^\d{3}  /.test(line))
    expect(events).toHaveLength(2)
    expect(text).toContain('* NOTE: 1 extra scenes omitted')
    expect(text).not.toContain('Slack')
    // 注释在头部、能会被剪辑软件忽略的位置（事件之前）
    expect(text.indexOf('* NOTE:')).toBeLessThan(text.indexOf('001  AX'))
  })

  it('跳过花絮后记录轨仍按真实间隔排布', () => {
    const text = renderEdl(
      day([scene(0, 60_000), scene(60_000, 120_000, 'Slack', '#general', 'extra'), scene(120_000, 180_000, 'Chrome')])
    )
    const events = text.split('\n').filter((line) => /^\d{3}  /.test(line))
    // 第三个镜头的记录入点 = 01:00:00:00 + 120s
    expect(events[1]).toContain('01:02:00:00 01:03:00:00')
    expect(events[1].startsWith('002  ')).toBe(true)
  })

  it('没有花絮时不出注释行', () => {
    expect(renderEdl(day([scene(0, 60_000)]))).not.toContain('NOTE')
    expect(renderEdl(day([]))).not.toContain('NOTE')
  })

  it('自动花絮（markSource: auto）同样不导出', () => {
    const autoExtra = { ...scene(60_000, 120_000, 'Slack', '#general'), mark: 'extra' as const, markSource: 'auto' as const }
    const text = renderEdl(day([scene(0, 60_000), autoExtra, scene(120_000, 180_000, 'Chrome')]))
    const events = text.split('\n').filter((line) => /^\d{3}  /.test(line))
    expect(events).toHaveLength(2)
    expect(text).toContain('* NOTE: 1 extra scenes omitted')
    expect(text).not.toContain('Slack')
  })
})
