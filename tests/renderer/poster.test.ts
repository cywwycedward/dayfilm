import { describe, expect, test } from 'vitest'
import type { ProjectRule } from '../../src/shared/settings'
import type { DayRollup, Scene, TopApp } from '../../src/shared/types'
import {
  POSTER_HEIGHT,
  POSTER_WIDTH,
  computePoster,
  truncateText,
  wrapText
} from '../../src/renderer/src/lib/poster'
import { fmtClock, startOfDay } from '../../src/renderer/src/lib/time'

const DAY = '2025-01-15'
const HOUR = 3_600_000
const MINUTE = 60_000
const dayStart = startOfDay(DAY)

function shot(
  id: string,
  fromHour: number,
  minutes: number,
  exe = 'Code',
  title = 'dayfilm - Visual Studio Code'
): Scene {
  const start = dayStart + fromHour * HOUR
  return { id, start, end: start + minutes * MINUTE, exe, title, seconds: minutes * 60, kind: 'shot' }
}

const topApps: TopApp[] = [
  { exe: 'Code', seconds: 3600 },
  { exe: 'chrome', seconds: 1800 },
  { exe: 'WeChat', seconds: 900 }
]

const projects: ProjectRule[] = [
  { name: 'Dayfilm', terms: ['dayfilm'] },
  { name: '阅读', terms: ['mdn', 'github'] }
]

function day(scenes: Scene[], apps: TopApp[] = topApps): DayRollup {
  return {
    date: DAY,
    firstAt: scenes[0]?.start ?? null,
    lastAt: scenes[scenes.length - 1]?.end ?? null,
    activeMs: scenes.reduce((sum, scene) => sum + (scene.end - scene.start), 0),
    idleMs: 0,
    scenes,
    cuts: Math.max(0, scenes.length - 1),
    longestShot: scenes.reduce<Scene | null>(
      (best, scene) => (!best || scene.seconds > best.seconds ? scene : best),
      null
    ),
    topApps: apps,
    verdict: { label: '标准剪辑', note: '平均每小时 3.6 次切换。', cutRate: 3.6 }
  }
}

// 9:00 长镜头 90 分、11:00 chrome 30 分、14:00 45 分；最密窗口在 14:00 一带
const scenes = [
  shot('a', 9, 90),
  shot('b', 11, 30, 'chrome', 'GitHub - dayfilm'),
  shot('c', 14, 45),
  shot('d', 14.1, 20, 'chrome', 'MDN'),
  shot('e', 14.2, 35, 'Code', 'dayfilm - 海报')
]

describe('wrapText / truncateText', () => {
  test('空文本没有行', () => {
    expect(wrapText('   ', 400, 20)).toEqual([])
    expect(truncateText('   ', 400, 20)).toBe('')
  })

  test('短文本保持一行', () => {
    expect(wrapText('今天很专注', 600, 20)).toEqual(['今天很专注'])
    expect(truncateText('跳切风暴', 600, 96)).toBe('跳切风暴')
  })

  test('按估算宽度断行且不丢字符', () => {
    const text = '今天上午完成了胶片缩放的实现，下午被消息切得很碎，晚上补完了海报导出与周视图。'
    const lines = wrapText(text, 240, 20)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join('')).toBe(text)
  })

  test('超宽的单行用省略号截断', () => {
    const text = truncateText('这是一个非常非常长的题材名称会被截断', 200, 96)
    expect(text.endsWith('…')).toBe(true)
    expect(text.length).toBeLessThan(10)
  })
})

describe('computePoster 版式', () => {
  const layout = computePoster({ day: day(scenes), projects, note: '今天把胶片缩放做完了，明天补海报。' })

  test('画布 1600×1000，左右两栏 600/760，外边距 96', () => {
    expect(layout.width).toBe(POSTER_WIDTH)
    expect(layout.height).toBe(POSTER_HEIGHT)
    expect(layout.columns.left).toEqual({ x: 96, w: 600 })
    expect(layout.columns.right).toEqual({ x: 744, w: 760 })
    expect(layout.columns.right.x + layout.columns.right.w).toBe(POSTER_WIDTH - 96)
  })

  test('左栏文字：日期 14、题材 96 单行、点评 16、数字 56、字标 Bebas 18', () => {
    const texts = layout.texts
    expect(texts[0].text).toBe('2025 年 1 月 15 日 · 周三')
    expect(texts[0]).toMatchObject({ family: 'mono', size: 14, weight: 400 })
    const genre = texts.find((item) => item.text === '标准剪辑')
    expect(genre).toMatchObject({ family: 'ui', size: 96, weight: 700, x: 96 })
    const note = texts.find((item) => item.text.includes('平均每小时'))
    expect(note).toMatchObject({ family: 'ui', size: 16 })
    const labels = texts.filter((item) => ['活跃时长', '镜头', '剪辑'].includes(item.text))
    expect(labels).toHaveLength(3)
    for (const label of labels) expect(label).toMatchObject({ family: 'mono', size: 12 })
    for (const value of texts.filter((item) => item.size === 56)) {
      expect(value.family).toBe('mono')
    }
    const wordmark = texts.find((item) => item.text === 'DAYFILM')
    expect(wordmark).toMatchObject({ family: 'display', size: 18, tone: 'accent' })
  })

  test('三项数字横向排开在 600 宽内', () => {
    const numbers = layout.texts.filter((item) => item.size === 56)
    expect(numbers.map((item) => item.x)).toEqual([96, 296, 496])
    expect(numbers.map((item) => item.text)).toEqual(['3 小时 40 分', '5', '4'])
  })

  test('胶片带按 firstAt..lastAt 铺满右栏，不是 00:00–24:00', () => {
    expect(layout.film).toEqual({ x: 744, y: 140, w: 760, h: 150 })
    const first = layout.blocks[0]
    const last = layout.blocks[layout.blocks.length - 1]
    expect(first.x).toBe(744)
    expect(last.x + last.w).toBeCloseTo(744 + 760, 6)
    const span = scenes[scenes.length - 1].end - scenes[0].start
    const second = layout.blocks[1]
    expect(second.x - 744).toBeCloseTo(((scenes[1].start - scenes[0].start) / span) * 760, 6)
    for (const block of layout.blocks) {
      expect(block.x).toBeGreaterThanOrEqual(744)
      expect(block.x + block.w).toBeLessThanOrEqual(1504)
    }
  })

  test('刻度尺 12 格，首尾是真实时刻', () => {
    expect(layout.ruler.ticks).toHaveLength(12)
    expect(layout.ruler.ticks[0]).toEqual({ x: 744, label: fmtClock(scenes[0].start) })
    expect(layout.ruler.ticks[11].x).toBe(1504)
    expect(layout.ruler.ticks[11].label).toBe(fmtClock(scenes[scenes.length - 1].end))
    expect(layout.ruler.y).toBeGreaterThan(layout.film.y + layout.film.h)
  })

  test('四张接触印相 340×191，两列两行等宽，图注对齐卡片左缘', () => {
    expect(layout.prints).toHaveLength(4)
    for (const print of layout.prints) {
      expect(print.w).toBe(340)
      expect(print.h).toBe(191)
      expect(print.caption).toMatch(/^\d\d:\d\d–\d\d:\d\d · /)
      expect(print.captionY).toBe(print.y + print.h + 20)
    }
    expect(layout.prints.map((print) => [print.x, print.y])).toEqual([
      [772, 356],
      [1136, 356],
      [772, 605],
      [1136, 605]
    ])
    // 两列等宽、间距 24，在 760 宽右栏里居中（两侧各 28）
    expect(layout.prints[1].x - (layout.prints[0].x + layout.prints[0].w)).toBe(24)
    expect(layout.prints[0].x - 744).toBe(28)
    expect(1504 - (layout.prints[1].x + layout.prints[1].w)).toBe(28)
    expect(layout.prints[2].y - (layout.prints[0].y + layout.prints[0].h)).toBeGreaterThan(0)
  })

  test('四张印相分别是最长、最密窗口最长、第一进程最长、当天最后一镜', () => {
    const [longest, densest, process, last] = layout.prints
    expect(longest.title).toBe('dayfilm - Visual Studio Code')
    expect(longest.caption).toBe(`${fmtClock(scenes[0].start)}–${fmtClock(scenes[0].end)} · 1 小时 30 分`)
    // 最密窗口从 14:00 起（c/d/e 三镜），里面最长的是 45 分的 c
    expect(densest.title).toBe(scenes[2].title)
    expect(densest.caption).toContain('45 分')
    // 时长第一的进程 Code：a 已用作第一张，取它下面最长的 e（35 分）
    expect(process.exe).toBe('Code')
    expect(process.caption).toContain('35 分')
    // 最后一镜 e 已占用，往前找未用的 d
    expect(last.title).toBe('MDN')
    expect(last.caption).toContain('20 分')
    const captions = layout.prints.map((print) => print.caption)
    expect(new Set(captions).size).toBe(captions.length)
  })

  test('背景题材水印：Bebas 280、4%、右对齐且只裁在右栏', () => {
    expect(layout.backdrop).toMatchObject({ text: '标准剪辑', size: 280, x: 1504, y: 760 })
    expect(layout.backdrop.opacity).toBeCloseTo(0.04, 6)
    expect(layout.backdrop.clip).toEqual({ x: 744, y: 0, w: 760, h: POSTER_HEIGHT })
    expect(layout.backdrop.fade).toBeGreaterThan(0)
  })

  test('页脚：底部发丝线 + DATE · 由 Dayfilm 生成', () => {
    expect(layout.footer.line).toEqual({ x0: 96, y: 868, x1: 1504 })
    expect(layout.footer.text).toBe('DAYFILM · 2025-01-15 · 由 Dayfilm 生成')
  })

  test('四张印相带放映版式参数：镜次、时间码、时长尺分母、族色、颇粒种子', () => {
    expect(layout.printTotal).toBe(scenes.length)
    for (const print of layout.prints) {
      expect(Number.isInteger(print.index)).toBe(true)
      expect(print.start).toBeLessThan(print.end)
      expect(print.seconds).toBeGreaterThan(0)
      expect(print.maxSeconds).toBe(90 * 60)
      expect(Number.isFinite(print.hue)).toBe(true)
      expect(Number.isFinite(print.grainSeed)).toBe(true)
    }
  })

  test('手记：只在有内容时出现，最多三行，带 2px 暖色竖线', () => {
    const note = layout.note
    expect(note).not.toBeNull()
    if (!note) throw new Error('缺少手记')
    expect(note.size).toBe(18)
    expect(note.lines.length).toBeLessThanOrEqual(3)
    expect(note.rule.w).toBe(2)
    expect(note.rule.x).toBe(96)
    expect(note.x).toBe(120)
    expect(note.y).toBe(496)
    expect(note.rule.y0).toBe(480)
    expect(note.rule.y1).toBeGreaterThan(note.rule.y0)
    expect(layout.extremes).toBeNull()
  })

  test('没有手记就画当日之最两行小字', () => {
    const bare = computePoster({ day: day(scenes), projects, note: '' })
    expect(bare.note).toBeNull()
    expect(bare.extremes).not.toBeNull()
    if (!bare.extremes) throw new Error('缺少当日之最')
    expect(bare.extremes).toMatchObject({ x: 96, y: 496, size: 12, lineHeight: 24 })
    expect(bare.extremes.lines).toEqual([
      `最长镜头 ${fmtClock(scenes[0].start)}–${fmtClock(scenes[0].end)} · 1 小时 30 分`,
      '最密 30 分钟 14:00–14:30 · 2 次剪辑'
    ])
  })

  test('所有矩形都在画布内', () => {
    const rects = [layout.film, ...layout.blocks, ...layout.prints]
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.w).toBeLessThanOrEqual(POSTER_WIDTH)
      expect(rect.y + rect.h).toBeLessThanOrEqual(POSTER_HEIGHT)
    }
    for (const text of layout.texts) {
      expect(text.y).toBeGreaterThan(0)
      expect(text.y).toBeLessThan(POSTER_HEIGHT)
    }
  })
})

describe('computePoster 分支', () => {
  test('没有手记就不画手记', () => {
    const layout = computePoster({ day: day(scenes), projects, note: '   ' })
    expect(layout.note).toBeNull()
  })

  test('没有项目规则也能出四张印相', () => {
    const layout = computePoster({ day: day(scenes), projects: [], note: '' })
    expect(layout.prints).toHaveLength(4)
  })

  test('没有进程/项目数据时只剩三张（最后一张仍是当天末镜）', () => {
    const layout = computePoster({ day: day(scenes, []), projects: [], note: '' })
    expect(layout.prints).toHaveLength(3)
    expect(layout.prints[2].caption).toBe(
      `${fmtClock(scenes[4].start)}–${fmtClock(scenes[4].end)} · 35 分`
    )
  })

  test('没有镜头时：题材未开镜、没有色块、没有印相与当日之最', () => {
    const layout = computePoster({ day: day([]), projects, note: '' })
    expect(layout.blocks).toEqual([])
    expect(layout.prints).toEqual([])
    expect(layout.extremes).toBeNull()
    expect(layout.texts.map((item) => item.text)).toContain('未开镜')
    expect(layout.ruler.ticks).toEqual([])
  })
})
