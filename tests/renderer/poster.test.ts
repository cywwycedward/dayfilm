import { describe, expect, test } from 'vitest'
import type { ProjectRule } from '../../src/shared/settings'
import type { DayRollup, Scene, TopApp } from '../../src/shared/types'
import {
  POSTER_HEIGHT,
  POSTER_MARGIN,
  POSTER_WIDTH,
  computePoster,
  posterPalette,
  truncateText,
  wrapText,
  type PosterLayout
} from '../../src/renderer/src/lib/poster'
import { fmtClock, fmtDuration, startOfDay } from '../../src/renderer/src/lib/time'

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
    verdict: { label: '标准剪辑', note: '平均每小时 3.6 次切换。', cutRate: 3.6 },    featureMs: 0,    extraMs: 0
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

/** 与 poster.ts 的估算同一口径（CJK 1em、ASCII 0.6em），只用来断言列不重叠。 */
function monoWidth(text: string, size: number): number {
  let width = 0
  for (const char of text) width += (char.charCodeAt(0) > 0x2e80 ? 1 : 0.6) * size
  return width
}

/** 三项数字按标签/数值成对排在 y=400 与 y=456。 */
function metricTexts(layout: PosterLayout): string[] {
  return layout.texts.filter((item) => item.y === 400 || item.y === 456).map((item) => item.text)
}

/** #rrggbb → WCAG 相对亮度 */
function luminance(hex: string): number {
  const channel = (value: number): number => {
    const ratio = value / 255
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4
  }
  return (
    0.2126 * channel(Number.parseInt(hex.slice(1, 3), 16)) +
    0.7152 * channel(Number.parseInt(hex.slice(3, 5), 16)) +
    0.0722 * channel(Number.parseInt(hex.slice(5, 7), 16))
  )
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

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

  test('三项数字按内容宽度排开，不重叠且在 600 宽内', () => {
    const numbers = layout.texts.filter((item) => item.size === 56)
    expect(numbers.map((item) => item.text)).toEqual(['3 小时 40 分', '5', '4'])
    expect(numbers[0].x).toBe(96)
    for (let index = 1; index < numbers.length; index += 1) {
      const previous = numbers[index - 1]
      // 上一列的估算宽度不跨到下一列，且至少留 40px 间隔
      expect(previous.x + monoWidth(previous.text, 56)).toBeLessThanOrEqual(numbers[index].x)
      expect(numbers[index].x - previous.x).toBeGreaterThanOrEqual(40)
    }
    expect(numbers[2].x + monoWidth('4', 56)).toBeLessThanOrEqual(96 + 600)
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
    const film = layout.film
    if (film === null) throw new Error('经典主题应有胶片带')
    expect(layout.ruler.y).toBeGreaterThan(film.y + film.h)
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
    const backdrop = layout.backdrop
    if (backdrop === null) throw new Error('经典主题应有题材水印')
    expect(backdrop).toMatchObject({ text: '标准剪辑', size: 280, x: 1504, y: 760 })
    expect(backdrop.opacity).toBeCloseTo(0.04, 6)
    expect(backdrop.clip).toEqual({ x: 744, y: 0, w: 760, h: POSTER_HEIGHT })
    expect(backdrop.fade).toBeGreaterThan(0)
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
    const film = layout.film
    if (film === null) throw new Error('经典主题应有胶片带')
    const rects = [film, ...layout.blocks, ...layout.prints]
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

describe('海报主题（R50）', () => {
  const note = '今天把胶片缩放做完了，明天补海报。'
  const themes = ['classic', 'noir', 'minimal'] as const
  const layoutFor = (theme: (typeof themes)[number]) =>
    computePoster({ day: day(scenes), projects, note, theme })

  test('三种主题画布同尺寸，必含元素都在版心内', () => {
    for (const theme of themes) {
      const layout = layoutFor(theme)
      expect(layout.width).toBe(POSTER_WIDTH)
      expect(layout.height).toBe(POSTER_HEIGHT)
      expect(layout.theme).toBe(theme)
      expect(layout.palette).toEqual(posterPalette(theme))
      const texts = layout.texts.map((item) => item.text)
      expect(texts).toContain('2025 年 1 月 15 日 · 周三')
      expect(texts).toContain('标准剪辑')
      for (const label of ['活跃时长', '镜头', '剪辑']) expect(texts).toContain(label)
      expect(texts).toContain('3 小时 40 分')
      for (const text of layout.texts) {
        expect(text.x).toBeGreaterThanOrEqual(POSTER_MARGIN)
        expect(text.x).toBeLessThanOrEqual(POSTER_WIDTH - POSTER_MARGIN)
        expect(text.y).toBeGreaterThan(POSTER_MARGIN)
        expect(text.y).toBeLessThan(POSTER_HEIGHT - POSTER_MARGIN)
      }
      for (const rect of layout.prints) {
        expect(rect.x).toBeGreaterThanOrEqual(POSTER_MARGIN)
        expect(rect.x + rect.w).toBeLessThanOrEqual(POSTER_WIDTH - POSTER_MARGIN)
      }
    }
  })

  test('不传主题就是经典：胶片带与四张印相都在', () => {
    const layout = computePoster({ day: day(scenes), projects, note })
    expect(layout.theme).toBe('classic')
    expect(layout.film).not.toBeNull()
    expect(layout.prints).toHaveLength(4)
  })

  test('黑色电影：胶片带收成细缝，只留一张最大图，标题字距更紧', () => {
    const layout = layoutFor('noir')
    const classic = layoutFor('classic')
    if (layout.film === null || classic.film === null) throw new Error('缺少胶片带')
    expect(layout.film.h).toBeLessThan(classic.film.h)
    expect(layout.film.w).toBe(classic.film.w)
    expect(layout.blocks.length).toBeGreaterThan(0)
    expect(layout.prints).toHaveLength(1)
    // 留下的就是最长镜头那张
    expect(layout.prints[0].caption).toBe(classic.prints[0].caption)
    expect(layout.prints[0].x).toBeGreaterThan(classic.prints[0].x)
    expect(layout.prints[0].w).toBeGreaterThan(classic.prints[0].w)
    // 图注紧贴在放大后的卡片下方，不被卡片遮住
    expect(layout.prints[0].captionY).toBe(layout.prints[0].y + layout.prints[0].h + 20)
    const genre = layout.texts.find((item) => item.text === '标准剪辑')
    expect(genre?.letterSpacing).toBeLessThan(0)
    expect(layout.palette.accent).not.toBe(classic.palette.accent)
  })

  test('极简：没有胶片带、没有接触印相、没有水印，只留一句手记', () => {
    const layout = layoutFor('minimal')
    expect(layout.film).toBeNull()
    expect(layout.holes).toBeNull()
    expect(layout.ruler.ticks).toEqual([])
    expect(layout.blocks).toEqual([])
    expect(layout.prints).toEqual([])
    expect(layout.backdrop).toBeNull()
    expect(layout.note).not.toBeNull()
    expect(layout.note?.lines.length).toBe(1)
    expect(layout.texts.map((item) => item.text)).not.toContain('平均每小时 3.6 次切换。')
    // 纸白底、墨黑字：背景与正文是两个极端
    expect(layout.palette.background).toBe('#efece4')
    expect(layout.palette.paper).toBe('#14161a')
  })

  test('三套主题的数字文本与格式化完全一致', () => {
    const classic = layoutFor('classic')
    const noir = layoutFor('noir')
    const minimal = layoutFor('minimal')
    // 标签 + 数值成对出现在 y=400/456
    expect(metricTexts(classic)).toEqual(['活跃时长', '3 小时 40 分', '镜头', '5', '剪辑', '4'])
    expect(metricTexts(noir)).toEqual(metricTexts(classic))
    expect(metricTexts(minimal)).toEqual(metricTexts(classic))
    // 同一个排版：三套主题的列位置也一致
    const xOf = (layout: typeof classic): number[] =>
      layout.texts.filter((item) => item.y === 456).map((item) => item.x)
    expect(xOf(noir)).toEqual(xOf(classic))
    expect(xOf(minimal)).toEqual(xOf(classic))
    // 活跃时长写「N 分 / N 小时 M 分」，镜头与剪辑是纯数字
    const values = metricTexts(minimal).filter((_, index) => index % 2 === 1)
    expect(values[0]).toMatch(/^\d+ 小时( \d\d 分)?$|^\d+ 分$/)
    expect(values[1]).toMatch(/^\d+$/)
    expect(values[2]).toMatch(/^\d+$/)
  })

  test('印相下的镜头时长用「N 分 M 秒」口径', () => {
    for (const theme of ['classic', 'noir'] as const) {
      const layout = layoutFor(theme)
      expect(layout.prints.length).toBeGreaterThan(0)
      for (const print of layout.prints) {
        expect(print.caption.endsWith(` · ${fmtDuration(print.seconds)}`)).toBe(true)
      }
      expect(layout.prints[0].caption).toMatch(/ · (\d+ 小时( \d\d 分)?|\d+ 分( \d\d 秒)?|\d+ 秒)$/)
    }
  })

  test('极简的纸白底上数字与正文都够对比', () => {
    for (const theme of themes) {
      const layout = layoutFor(theme)
      expect(contrast(layout.palette.background, layout.palette.paper)).toBeGreaterThan(7)
      // 数字用的 tone 是 title → palette.paper，与底色对比足够
      for (const value of layout.texts.filter((item) => item.size === 56)) {
        expect(value.tone).toBe('title')
      }
    }
    expect(layoutFor('minimal').palette.background).toBe('#efece4')
  })

  test('空的一天三种主题都给出有限坐标', () => {
    for (const theme of themes) {
      const layout = computePoster({ day: day([]), projects, note: '', theme })
      expect(layout.prints).toEqual([])
      expect(layout.note).toBeNull()
      expect(Number.isFinite(layout.ruler.y)).toBe(true)
      expect(layout.footer.text).toBe(`DAYFILM · ${DAY} · 由 Dayfilm 生成`)
    }
  })
})
