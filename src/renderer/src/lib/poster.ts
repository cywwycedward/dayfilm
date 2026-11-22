/**
 * 海报布局：1600×1000 上每一块矩形、每一行文字都在这里算好，
 * 绘制函数只负责按参数调用 ctx。纯函数，空数据也给出有限坐标。
 */
import type { ProjectRule } from '../../../shared/settings'
import { totalByProject } from '../../../shared/projects'
import type { DayRollup } from '../../../shared/types'
import { fmtDuration, fmtMinutes, startOfDay } from './time'

export const POSTER_WIDTH = 1600
export const POSTER_HEIGHT = 1000
const MARGIN = 80

export type PosterTone = 'display' | 'title' | 'label' | 'body' | 'muted' | 'accent'

export interface PosterText {
  x: number
  y: number
  size: number
  weight: number
  tone: PosterTone
  text: string
}

export interface PosterStill {
  x: number
  y: number
  w: number
  h: number
  exe: string
  title: string
}

export interface PosterBar {
  x: number
  y: number
  w: number
  h: number
  /** 0–1 */
  level: number
}

export interface PosterRow {
  label: string
  value: string
  x: number
  y: number
  bar: PosterBar
}

export interface PosterLayout {
  width: number
  height: number
  texts: PosterText[]
  rows: PosterRow[]
  stills: PosterStill[]
  film: { x: number; y: number; w: number; h: number }
  note: { x: number; y: number; size: number; lineHeight: number; lines: string[] } | null
}

export interface PosterInput {
  day: DayRollup
  projects: readonly ProjectRule[]
  note: string
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

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function dateLine(day: DayRollup): string {
  const date = new Date(startOfDay(day.date))
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 · ${WEEKDAYS[date.getDay()]}`
}

const FILM = { x: MARGIN, y: 480, w: POSTER_WIDTH - MARGIN * 2, h: 180 }
const ROWS_TOP = 710
const ROW_GAP = 52
const BAR_MAX = 420

export function computePoster(input: PosterInput): PosterLayout {
  const { day, projects, note } = input
  const shots = day.scenes.filter((scene) => scene.kind === 'shot')
  const texts: PosterText[] = [
    { x: MARGIN, y: 118, size: 40, weight: 500, tone: 'muted', text: dateLine(day) },
    {
      x: MARGIN,
      y: 226,
      size: 88,
      weight: 700,
      tone: 'display',
      text: shots.length > 0 ? day.verdict.label : '未开镜'
    },
    { x: MARGIN, y: 300, size: 22, weight: 400, tone: 'body', text: day.verdict.note }
  ]

  const metrics: [string, string][] = [
    ['活跃时长', fmtMinutes(day.activeMs)],
    ['镜头', `${shots.length}`],
    ['剪辑', `${day.cuts}`]
  ]
  metrics.forEach(([label, value], index) => {
    const x = MARGIN + index * 380
    texts.push({ x, y: 386, size: 18, weight: 500, tone: 'muted', text: label })
    texts.push({ x, y: 436, size: 40, weight: 600, tone: 'title', text: value })
  })

  // 当日胶片缩略：按 00:00–24:00 铺开；镜头太多时等间隔抽样，保证绘制量可控
  const dayStart = startOfDay(day.date)
  const step = shots.length > 200 ? Math.ceil(shots.length / 200) : 1
  const stills: PosterStill[] = []
  shots.forEach((scene, index) => {
    if (index % step !== 0) return
    const from = (Math.max(dayStart, scene.start) - dayStart) / 86_400_000
    const to = (Math.min(dayStart + 86_400_000, scene.end) - dayStart) / 86_400_000
    const x = FILM.x + from * FILM.w
    const w = Math.max(2, (to - from) * FILM.w)
    stills.push({ x, y: FILM.y, w, h: FILM.h, exe: scene.exe, title: scene.title })
  })

  const apps = day.topApps.slice(0, 4)
  const appPeak = apps.reduce((peak, app) => Math.max(peak, app.seconds), 0)
  const rows: PosterRow[] = apps.map((app, index) => ({
    label: app.exe,
    value: fmtMinutes(app.seconds * 1000),
    x: MARGIN,
    y: ROWS_TOP + index * ROW_GAP,
    bar: { x: MARGIN, y: ROWS_TOP + index * ROW_GAP + 36, w: BAR_MAX, h: 6, level: appPeak > 0 ? app.seconds / appPeak : 0 }
  }))

  const projectTotals = totalByProject(day.scenes, projects).slice(0, 3)
  const projectPeak = projectTotals.reduce((peak, item) => Math.max(peak, item.ms), 0)
  const projectRows: PosterRow[] = projectTotals.map((item, index) => ({
    label: item.name,
    value: fmtMinutes(item.ms),
    x: POSTER_WIDTH / 2,
    y: ROWS_TOP + index * ROW_GAP,
    bar: {
      x: POSTER_WIDTH / 2,
      y: ROWS_TOP + index * ROW_GAP + 36,
      w: BAR_MAX,
      h: 6,
      level: projectPeak > 0 ? item.ms / projectPeak : 0
    }
  }))

  const longest = day.longestShot
  texts.push({
    x: MARGIN,
    y: 928,
    size: 22,
    weight: 500,
    tone: 'body',
    text: longest
      ? `最长镜头 ${fmtDuration(longest.seconds)} · ${longest.exe || '中场休息'}`
      : '今天还没有镜头'
  })

  const noteLines = wrapText(note, 660, 22).slice(0, 3)
  texts.push({ x: MARGIN, y: POSTER_HEIGHT - 40, size: 16, weight: 600, tone: 'accent', text: 'DAYFILM' })
  return {
    width: POSTER_WIDTH,
    height: POSTER_HEIGHT,
    texts,
    rows: [...rows, ...projectRows],
    stills,
    film: FILM,
    note:
      noteLines.length > 0
        ? { x: POSTER_WIDTH / 2, y: 858, size: 22, lineHeight: 34, lines: noteLines }
        : null
  }
}
