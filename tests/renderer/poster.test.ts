import { describe, expect, test } from 'vitest'
import type { ProjectRule } from '../../src/shared/settings'
import type { DayRollup, Scene, TopApp } from '../../src/shared/types'
import {
  POSTER_HEIGHT,
  POSTER_WIDTH,
  computePoster,
  wrapText
} from '../../src/renderer/src/lib/poster'
import { startOfDay } from '../../src/renderer/src/lib/time'

const DAY = '2025-01-15'
const HOUR = 3_600_000
const MINUTE = 60_000
const dayStart = startOfDay(DAY)

function shot(id: string, fromHour: number, minutes: number, exe = 'Code', title = 'dayfilm - Visual Studio Code'): Scene {
  const start = dayStart + fromHour * HOUR
  return { id, start, end: start + minutes * MINUTE, exe, title, seconds: minutes * 60, kind: 'shot' }
}

const topApps: TopApp[] = [
  { exe: 'Code', seconds: 3600 },
  { exe: 'chrome', seconds: 1800 },
  { exe: 'WeChat', seconds: 900 },
  { exe: 'Slack', seconds: 600 },
  { exe: 'Figma', seconds: 300 }
]

const projects: ProjectRule[] = [
  { name: 'Dayfilm', terms: ['dayfilm'] },
  { name: '阅读', terms: ['mdn', 'github'] }
]

function day(scenes: Scene[]): DayRollup {
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
    verdict: { label: '标准剪辑', note: '平均每小时 3.6 次切换。', cutRate: 3.6 }
  }
}

describe('wrapText', () => {
  test('空文本没有行', () => {
    expect(wrapText('   ', 400, 20)).toEqual([])
  })

  test('短文本保持一行', () => {
    expect(wrapText('今天很专注', 600, 20)).toEqual(['今天很专注'])
  })

  test('按估算宽度断行且不丢字符', () => {
    const text = '今天上午完成了胶片缩放的实现，下午被消息切得很碎，晚上补完了海报导出与周视图，明天继续做高光卡片。'
    const lines = wrapText(text, 240, 20)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join('')).toBe(text)
    for (const line of lines) {
      const width = [...line].reduce((sum, char) => sum + (char.charCodeAt(0) > 0x2e80 ? 20 : 11), 0)
      expect(width).toBeLessThanOrEqual(240 + 11)
    }
  })

  test('ASCII 按窄字计算', () => {
    const lines = wrapText('abcdefghij', 60, 20)
    expect(lines.join('')).toBe('abcdefghij')
    expect(lines.length).toBeGreaterThan(1)
  })
})

describe('computePoster', () => {
  const scenes = [shot('a', 9, 90), shot('b', 11, 30, 'chrome', 'GitHub - dayfilm'), shot('c', 14, 45)]
  const layout = computePoster({ day: day(scenes), projects, note: '今天把胶片缩放做完了，明天补海报。' })

  test('画布尺寸与全部矩形都在画布内', () => {
    expect(layout.width).toBe(POSTER_WIDTH)
    expect(layout.height).toBe(POSTER_HEIGHT)
    const rects = [
      layout.film,
      ...layout.stills,
      ...layout.rows.map((row) => row.bar),
      ...layout.rows.map((row) => ({ x: row.x, y: row.y, w: 0, h: 0 }))
    ]
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.w).toBeLessThanOrEqual(POSTER_WIDTH)
      expect(rect.y + rect.h).toBeLessThanOrEqual(POSTER_HEIGHT)
    }
    for (const text of layout.texts) {
      expect(text.x).toBeGreaterThan(0)
      expect(text.y).toBeGreaterThan(0)
      expect(text.y).toBeLessThan(POSTER_HEIGHT)
      expect(Number.isFinite(text.size)).toBe(true)
    }
  })

  test('包含日期星期、题材、点评与三项数字', () => {
    const texts = layout.texts.map((item) => item.text)
    expect(texts).toContain('2025 年 1 月 15 日 · 周三')
    expect(texts).toContain('标准剪辑')
    expect(texts).toContain('平均每小时 3.6 次切换。')
    expect(texts).toContain('活跃时长')
    expect(texts).toContain('镜头')
    expect(texts).toContain('剪辑')
    expect(texts).toContain('3')
  })

  test('当日胶片缩略按时间顺序铺在胶片条里', () => {
    expect(layout.stills).toHaveLength(scenes.length)
    for (let index = 1; index < layout.stills.length; index += 1) {
      expect(layout.stills[index].x).toBeGreaterThanOrEqual(layout.stills[index - 1].x)
    }
    for (const still of layout.stills) {
      expect(still.x).toBeGreaterThanOrEqual(layout.film.x)
      expect(still.x + still.w).toBeLessThanOrEqual(layout.film.x + layout.film.w + 0.001)
      expect(still.h).toBe(layout.film.h)
    }
  })

  test('进程前 4、项目前 3，项目按命中时长倒序', () => {
    const appRows = layout.rows.filter((row) => row.x === 80)
    const projectRows = layout.rows.filter((row) => row.x === POSTER_WIDTH / 2)
    expect(appRows).toHaveLength(4)
    expect(appRows[0].label).toBe('Code')
    expect(projectRows.length).toBeLessThanOrEqual(3)
    expect(projectRows[0].label).toBe('Dayfilm')
  })

  test('没有项目规则时不画项目行', () => {
    const plain = computePoster({ day: day(scenes), projects: [], note: '' })
    expect(plain.rows.filter((row) => row.x === POSTER_WIDTH / 2)).toHaveLength(0)
  })

  test('手记有内容才画，最多三行', () => {
    expect(layout.note?.lines.length).toBeGreaterThan(0)
    expect(layout.note?.lines.length).toBeLessThanOrEqual(3)
    const empty = computePoster({ day: day(scenes), projects, note: '' })
    expect(empty.note).toBeNull()
  })

  test('空日也能算出有限坐标', () => {
    const emptyLayout = computePoster({ day: day([]), projects, note: '' })
    expect(emptyLayout.stills).toEqual([])
    expect(emptyLayout.texts.map((item) => item.text)).toContain('未开镜')
    const numbers = emptyLayout.texts.flatMap((item) => [item.x, item.y, item.size, item.weight])
    expect(numbers.every((value) => Number.isFinite(value))).toBe(true)
  })
})
