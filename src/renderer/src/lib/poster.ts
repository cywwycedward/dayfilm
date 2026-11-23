/**
 * 海报布局：1600×1000 的一日电影海报，所有矩形与字号都在这里算好。
 * 纯函数：给定当日数据、项目规则与手记，返回可直接绘制的参数；空数据也给出有限坐标。
 */
import type { ProjectRule } from '../../../shared/settings'
import { totalByProject } from '../../../shared/projects'
import type { DayRollup, Scene } from '../../../shared/types'
import { exeHue } from './still'
import { hashString } from './hash'
import { fmtClock, fmtDuration, fmtMinutes, startOfDay } from './time'

export const POSTER_WIDTH = 1600
export const POSTER_HEIGHT = 1000
export const POSTER_MARGIN = 96
/** 左栏 */
export const COLUMN_LEFT = { x: POSTER_MARGIN, w: 600 }
/** 右栏：起于 744，止于右边距 */
export const COLUMN_RIGHT = { x: 744, w: POSTER_WIDTH - 96 - 744 }

const PRINT_W = 340
const PRINT_H = 191
const PRINT_GAP = 24
const PRINT_CAPTION_GAP = 20
const PRINT_ROW_GAP = 26
const RULER_TICKS = 12
/** 三项数字之间至少留的横向间隔 */
const METRIC_GAP = 40

export type PosterTheme = 'classic' | 'noir' | 'minimal'

export const POSTER_THEMES: readonly { id: PosterTheme; label: string }[] = [
  { id: 'classic', label: '经典' },
  { id: 'noir', label: '黑色电影' },
  { id: 'minimal', label: '极简' }
]

export interface PosterPalette {
  background: string
  /** 胶片带与印相框的底色 */
  panel: string
  paper: string
  dim: string
  muted: string
  hairline: string
  accent: string
  body: string
}

const PALETTES: Record<PosterTheme, PosterPalette> = {
  classic: {
    background: '#0a0b0d',
    panel: '#101216',
    paper: '#ece7dc',
    dim: 'rgba(236,231,220,.55)',
    muted: 'rgba(236,231,220,.4)',
    hairline: 'rgba(236,231,220,.12)',
    accent: '#e8b45a',
    body: 'rgba(236,231,220,.7)'
  },
  noir: {
    background: '#07080a',
    panel: '#0c0d10',
    paper: '#f2ede2',
    dim: 'rgba(242,237,226,.5)',
    muted: 'rgba(242,237,226,.34)',
    hairline: 'rgba(242,237,226,.16)',
    accent: '#b8524a',
    body: 'rgba(242,237,226,.72)'
  },
  minimal: {
    background: '#efece4',
    panel: '#e4e0d6',
    paper: '#14161a',
    dim: 'rgba(20,22,26,.5)',
    muted: 'rgba(20,22,26,.38)',
    hairline: 'rgba(20,22,26,.14)',
    accent: '#14161a',
    body: 'rgba(20,22,26,.7)'
  }
}

/** 胶片带高度：黑色电影只剩一条细缝，极简没有胶片带。 */
const STRIP_HEIGHT: Record<PosterTheme, number> = { classic: 150, noir: 28, minimal: 0 }

export type PosterTone = 'display' | 'title' | 'label' | 'body' | 'muted' | 'accent'

/** 主题只决定配色与取舍，版式坐标大部分共用。 */
export function posterPalette(theme: PosterTheme): PosterPalette {
  return PALETTES[theme]
}

export interface PosterText {
  x: number
  y: number
  size: number
  weight: number
  tone: PosterTone
  text: string
  family: 'display' | 'ui' | 'mono'
  align?: 'left' | 'right'
  maxWidth?: number
  /** 负值收紧字距；黑色电影标题用 */
  letterSpacing?: number
}

export interface PosterRect {
  x: number
  y: number
  w: number
  h: number
}

/** 胶片带里的一段镜头：族色块 */
export interface PosterBlock extends PosterRect {
  hue: number
}

export interface PosterTick {
  x: number
  label: string
}

export interface PosterPrint extends PosterRect {
  exe: string
  title: string
  /** 当天镜次（1 开始） */
  index: number
  caption: string
  captionY: number
  /** 放映版式需要的输入：与放映画面完全同源 */
  start: number
  end: number
  seconds: number
  maxSeconds: number
  hue: number
  grainSeed: number
}

export interface PosterNote {
  x: number
  y: number
  size: number
  lineHeight: number
  lines: string[]
  rule: { x: number; y0: number; y1: number; w: number }
}

export interface PosterLayout {
  width: number
  height: number
  date: string
  theme: PosterTheme
  palette: PosterPalette
  columns: { left: { x: number; w: number }; right: { x: number; w: number } }
  /** 背景题材水印；极简主题不画 */
  backdrop: {
    text: string
    x: number
    y: number
    size: number
    opacity: number
    /** 只压在右栏，不要盖到左栏的数字与手记 */
    clip: { x: number; y: number; w: number; h: number }
    /** 左缘渐显宽度，避免硬剪切痕 */
    fade: number
  } | null
  texts: PosterText[]
  /** 胶片带；极简主题没有 */
  film: PosterRect | null
  holes: { top: number; bottom: number; w: number; h: number; gap: number } | null
  blocks: PosterBlock[]
  ruler: { y: number; x0: number; x1: number; ticks: PosterTick[] }
  prints: PosterPrint[]
  /** 当天镜头总数，给印相里的 SHOT n / total */
  printTotal: number
  note: PosterNote | null
  /** 无手记时占位：当日之最两行小字 */
  extremes: { x: number; y: number; size: number; lineHeight: number; lines: string[] } | null
  footer: { line: { x0: number; y: number; x1: number }; text: string }
}

export interface PosterInput {
  day: DayRollup
  projects: readonly ProjectRule[]
  note: string
  /** 不传就是经典主题 */
  theme?: PosterTheme
}

/** 估算文本宽度（中文按 1em，ASCII 按 0.55em），太长就按宽度断行。 */
export function wrapText(text: string, maxWidthPx: number, fontSize: number): string[] {
  const trimmed = text.trim()
  if (trimmed.length === 0) return []
  const lines: string[] = []
  let current = ''
  let width = 0
  for (const char of trimmed) {
    const cost = (char.charCodeAt(0) > 0x2e80 ? 1 : 0.55) * fontSize
    if (width + cost > maxWidthPx && current.length > 0) {
      lines.push(current)
      current = char
      width = cost
    } else {
      current += char
      width += cost
    }
  }
  if (current.length > 0) lines.push(current)
  return lines
}

/** 等宽字体文本宽度估算：CJK 回落按全宽 1em，ASCII 按 Plex Mono 的 0.6em。 */
function monoTextWidth(text: string, size: number): number {
  let width = 0
  for (const char of text) width += (char.charCodeAt(0) > 0x2e80 ? 1 : 0.6) * size
  return width
}

/** 单行截断：超出宽度就补省略号。 */
export function truncateText(text: string, maxWidthPx: number, fontSize: number): string {
  const chars = [...text.trim()]
  let width = 0
  let out = ''
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]
    const cost = (char.charCodeAt(0) > 0x2e80 ? 1 : 0.55) * fontSize
    if (width + cost > maxWidthPx) return `${out}…`
    out += char
    width += cost
  }
  return out
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function dateLine(day: DayRollup): string {
  const date = new Date(startOfDay(day.date))
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 · ${WEEKDAYS[date.getDay()]}`
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** 12 个等距刻度的真实时刻。 */
function rulerTicks(firstAt: number, lastAt: number): PosterTick[] {
  const span = Math.max(1, lastAt - firstAt)
  const ticks: PosterTick[] = []
  for (let index = 0; index < RULER_TICKS; index += 1) {
    const ratio = index / (RULER_TICKS - 1)
    ticks.push({
      x: Math.round(COLUMN_RIGHT.x + ratio * COLUMN_RIGHT.w),
      label: fmtClock(firstAt + ratio * span)
    })
  }
  return ticks
}

/** 最密 30 分钟窗口内的镜头及其起止。 */
function busiestWindow(shots: readonly Scene[]): { shots: Scene[]; start: number; end: number } {
  if (shots.length === 0) return { shots: [], start: 0, end: 0 }
  const window = 30 * 60_000
  let bestStart = shots[0].start
  let bestCount = -1
  for (const anchor of shots) {
    const end = anchor.start + window
    let count = 0
    for (const shot of shots) {
      if (shot.start >= anchor.start && shot.start < end) count += 1
    }
    if (count > bestCount) {
      bestCount = count
      bestStart = anchor.start
    }
  }
  return {
    shots: shots.filter((shot) => shot.start >= bestStart && shot.start < bestStart + window),
    start: bestStart,
    end: bestStart + window
  }
}

/** 候选里最长且未被别的印相占用的镜头。 */
function longestUnused(candidates: readonly Scene[], used: ReadonlySet<string>): Scene | null {
  let best: Scene | null = null
  for (const shot of candidates) {
    if (used.has(shot.id)) continue
    if (!best || shot.seconds > best.seconds) best = shot
  }
  return best
}

export function computePoster(input: PosterInput): PosterLayout {
  const { day, projects, note } = input
  const theme = input.theme ?? 'classic'
  const palette = posterPalette(theme)
  const minimal = theme === 'minimal'
  const noir = theme === 'noir'
  const stripHeight = STRIP_HEIGHT[theme]
  const shots = day.scenes.filter((scene) => scene.kind === 'shot')
  const date = day.date
  const noteWidth = COLUMN_LEFT.w - 24
  const genre = truncateText(shots.length > 0 ? day.verdict.label : '未开镜', COLUMN_LEFT.w, 96)

  const texts: PosterText[] = [
    {
      x: COLUMN_LEFT.x,
      y: 150,
      size: 14,
      weight: 400,
      family: 'mono',
      tone: 'muted',
      text: dateLine(day)
    },
    {
      x: COLUMN_LEFT.x,
      y: 270,
      size: 96,
      weight: 700,
      family: 'ui',
      tone: 'display',
      text: genre,
      ...(noir ? { letterSpacing: -2 } : {})
    },
    // 极简只留日期、题材、数字与一句手记，点评不进海报
    ...(minimal ? [] : wrapText(day.verdict.note, COLUMN_LEFT.w, 16).slice(0, 2))
      .map((line, index) => ({
        x: COLUMN_LEFT.x,
        y: 312 + index * 26,
        size: 16,
        weight: 400,
        family: 'ui' as const,
        tone: 'body' as const,
        text: line
      }))
  ]

  const metrics: [string, string][] = [
    ['活跃时长', fmtMinutes(day.activeMs)],
    ['镜头', String(shots.length)],
    ['剪辑', String(day.cuts)]
  ]
  // 三列按内容的估算宽度排开：时长可能是「12 小时 34 分」，固定 200px 会把数字压到相邻列
  let metricX = COLUMN_LEFT.x
  for (const [label, value] of metrics) {
    texts.push({ x: metricX, y: 400, size: 12, weight: 400, family: 'mono', tone: 'muted', text: label })
    texts.push({ x: metricX, y: 456, size: 56, weight: 400, family: 'mono', tone: 'title', text: value })
    metricX += Math.round(Math.max(monoTextWidth(value, 56), monoTextWidth(label, 12)) + METRIC_GAP)
  }
  texts.push({
    x: COLUMN_LEFT.x,
    y: 832,
    size: 18,
    weight: 400,
    family: 'display',
    tone: 'accent',
    text: 'DAYFILM'
  })

  const firstAt = shots.length > 0 ? shots[0].start : null
  const lastAt = shots.length > 0 ? shots[shots.length - 1].end : null
  const film: PosterRect | null =
    stripHeight > 0 ? { x: COLUMN_RIGHT.x, y: 140, w: COLUMN_RIGHT.w, h: stripHeight } : null

  const blocks: PosterBlock[] = []
  if (film !== null && firstAt !== null && lastAt !== null && lastAt > firstAt) {
    const span = lastAt - firstAt
    // 镜头过多时抽样，保证绘制量可控；抽样仍按素材区间铺满
    const step = shots.length > 160 ? Math.ceil(shots.length / 160) : 1
    shots.forEach((scene, index) => {
      if (index % step !== 0) return
      const from = clamp01((scene.start - firstAt) / span)
      const to = clamp01((scene.end - firstAt) / span)
      blocks.push({
        x: film.x + from * film.w,
        y: film.y,
        w: Math.max(2, (to - from) * film.w),
        h: film.h,
        hue: exeHue(scene.exe.length > 0 ? scene.exe : scene.title)
      })
    })
  }

  const ruler = {
    y: film !== null ? film.y + film.h + 22 : 0,
    x0: COLUMN_RIGHT.x,
    x1: COLUMN_RIGHT.x + COLUMN_RIGHT.w,
    ticks: film !== null && firstAt !== null && lastAt !== null ? rulerTicks(firstAt, lastAt) : []
  }

  const prints: PosterPrint[] = []
  const used = new Set<string>()
  const longestSeconds = Math.max(1, ...shots.map((scene) => scene.seconds))
  // 经典四张两列，两侧各留 28；黑色电影只留一张最大图，放大后居中
  const printW = noir ? 540 : PRINT_W
  const printH = noir ? 303 : PRINT_H
  const printTop = noir ? 240 : 356
  const gridX = noir
    ? COLUMN_RIGHT.x + Math.round((COLUMN_RIGHT.w - printW) / 2)
    : COLUMN_RIGHT.x + Math.round((COLUMN_RIGHT.w - (PRINT_W * 2 + PRINT_GAP)) / 2)
  const pushPrint = (scene: Scene | null): void => {
    if (!scene || used.has(scene.id)) return
    used.add(scene.id)
    const index = prints.length
    const x = noir ? gridX : gridX + (index % 2) * (PRINT_W + PRINT_GAP)
    const y = printTop + Math.floor(index / 2) * (printH + PRINT_CAPTION_GAP + 12 + PRINT_ROW_GAP)
    const ordinal = shots.indexOf(scene) + 1
    prints.push({
      x,
      y,
      w: printW,
      h: printH,
      exe: scene.exe,
      title: scene.title.length > 0 ? scene.title : '—',
      index: ordinal,
      caption: `${fmtClock(scene.start)}–${fmtClock(scene.end)} · ${fmtDuration(scene.seconds)}`,
      captionY: y + printH + PRINT_CAPTION_GAP,
      start: scene.start,
      end: scene.end,
      seconds: scene.seconds,
      maxSeconds: longestSeconds,
      hue: exeHue(scene.exe.length > 0 ? scene.exe : scene.title),
      grainSeed: hashString(scene.id)
    })
  }

  const longest = day.longestShot ?? shots.reduce<Scene | null>((best, scene) => (!best || scene.seconds > best.seconds ? scene : best), null)
  const topProcess = day.topApps[0]?.exe ?? null
  const projectTotal = totalByProject(day.scenes, projects)[0]?.name ?? null
  const busiest = busiestWindow(shots)
  if (!minimal) {
    // 黑色电影只留最早的那张“最大图”；经典按最长/最密/第一进程/末镜各一张
    pushPrint(longest)
    if (!noir) {
      pushPrint(longestUnused(busiest.shots, used))
      let processShots: Scene[] = []
      if (topProcess) {
        processShots = shots.filter((scene) => scene.exe === topProcess)
      } else if (projectTotal) {
        const needle = projectTotal.toLowerCase()
        processShots = shots.filter((scene) => scene.title.toLowerCase().includes(needle))
      }
      pushPrint(longestUnused(processShots, used))
      // 第四张：当天最后一个镜头；若已被占用就往前找，保证四张不重复
      pushPrint([...shots].reverse().find((scene) => !used.has(scene.id)) ?? null)
    }
  }

  const noteLines = wrapText(note, noteWidth, 18).slice(0, minimal ? 1 : 3)
  const noteBlock: PosterNote | null =
    noteLines.length > 0
      ? {
          x: COLUMN_LEFT.x + 24,
          y: 496,
          size: 18,
          lineHeight: 28,
          lines: noteLines,
          rule: { x: COLUMN_LEFT.x, y0: 480, y1: 480 + noteLines.length * 28, w: 2 }
        }
      : null

  // 没手记时用“当日之最”两行小字填数字下方
  const extremeLines: string[] = []
  if (longest) {
    extremeLines.push(
      `最长镜头 ${fmtClock(longest.start)}–${fmtClock(longest.end)} · ${fmtDuration(longest.seconds)}`
    )
  }
  if (busiest.shots.length > 0) {
    extremeLines.push(
      `最密 30 分钟 ${fmtClock(busiest.start)}–${fmtClock(busiest.end)} · ${Math.max(0, busiest.shots.length - 1)} 次剪辑`
    )
  }
  const extremes =
    noteBlock !== null || extremeLines.length === 0
      ? null
      : { x: COLUMN_LEFT.x, y: 496, size: 12, lineHeight: 24, lines: extremeLines }

  return {
    width: POSTER_WIDTH,
    height: POSTER_HEIGHT,
    date,
    theme,
    palette,
    columns: { left: COLUMN_LEFT, right: COLUMN_RIGHT },
    backdrop: minimal
      ? null
      : {
          text: genre,
          x: COLUMN_RIGHT.x + COLUMN_RIGHT.w,
          y: 760,
          size: 280,
          opacity: noir ? 0.06 : 0.04,
          clip: { x: COLUMN_RIGHT.x, y: 0, w: COLUMN_RIGHT.w, h: POSTER_HEIGHT },
          fade: 120
        },
    texts,
    film,
    holes:
      film === null
        ? null
        : film.h < 40
          ? { top: film.y + 4, bottom: film.y + film.h - 8, w: 8, h: 4, gap: 22 }
          : { top: film.y + 6, bottom: film.y + film.h - 14, w: 10, h: 8, gap: 28 },
    blocks,
    ruler,
    prints,
    printTotal: shots.length,
    note: noteBlock,
    extremes,
    footer: {
      line: { x0: POSTER_MARGIN, y: 868, x1: POSTER_WIDTH - POSTER_MARGIN },
      text: `DAYFILM · ${date} · 由 Dayfilm 生成`
    }
  }
}
