/**
 * 双日对比的纯参数（R51）：两侧读数与差异列都只由两份 DayRollup 算出。
 * 任一天没有镜头就算空侧：读数是 "—"，差值也是 null，界面据此上色。
 */
import type { DayRollup, Scene } from '../../../shared/types'
import { exeHue } from './still'
import { fmtMinutes } from './time'

export type CompareUnit = 'ms' | 'count' | 'rate'

export interface CompareMetric {
  label: string
  value: string
}

/** 素材区间带里的一段：起止都是当天首尾之间的比例 0–1。 */
export interface CompareBlock {
  from: number
  to: number
  hue: number
}

export interface CompareSide {
  /** 当天有数据时是真实日期；空侧为空串，由界面用下拉框的日期 */
  date: string
  empty: boolean
  genre: string
  note: string
  /** 三项数字：活跃时长 / 镜头 / 剪辑 */
  metrics: CompareMetric[]
  blocks: CompareBlock[]
  /** 进程前 3 */
  apps: { exe: string; value: string; hue: number }[]
}

export interface CompareDiffItem {
  label: string
  /** 左侧读数 */
  current: string
  /** 右侧读数 */
  previous: string
  /** 左减右；任一侧无数据时为 null，界面显示 "—" */
  delta: number | null
  unit: CompareUnit
}

export interface CompareResult {
  left: CompareSide
  right: CompareSide
  diff: CompareDiffItem[]
}

function shotsOf(day: DayRollup | null): Scene[] {
  if (day === null) return []
  return day.scenes.filter((scene) => scene.kind === 'shot')
}

function blocksOf(shots: readonly Scene[]): CompareBlock[] {
  if (shots.length === 0) return []
  const start = shots[0].start
  const end = shots[shots.length - 1].end
  const span = Math.max(1, end - start)
  // 与海报同口径：镜头过多时抽样，绘制量可控
  const step = shots.length > 120 ? Math.ceil(shots.length / 120) : 1
  const blocks: CompareBlock[] = []
  for (let index = 0; index < shots.length; index += step) {
    const scene = shots[index]
    blocks.push({
      from: (scene.start - start) / span,
      to: (scene.end - start) / span,
      hue: exeHue(scene.exe.length > 0 ? scene.exe : scene.title)
    })
  }
  return blocks
}

function sideOf(day: DayRollup | null): CompareSide {
  const shots = shotsOf(day)
  if (day === null || shots.length === 0) {
    return {
      date: day?.date ?? '',
      empty: true,
      genre: '',
      note: '',
      metrics: [
        { label: '活跃时长', value: '—' },
        { label: '镜头', value: '—' },
        { label: '剪辑', value: '—' }
      ],
      blocks: [],
      apps: []
    }
  }
  return {
    date: day.date,
    empty: false,
    genre: day.verdict.label,
    note: day.verdict.note,
    metrics: [
      { label: '活跃时长', value: fmtMinutes(day.activeMs) },
      { label: '镜头', value: String(shots.length) },
      { label: '剪辑', value: String(day.cuts) }
    ],
    blocks: blocksOf(shots),
    apps: [...day.topApps]
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 3)
      .map((app) => ({ exe: app.exe, value: fmtMinutes(app.seconds * 1000), hue: exeHue(app.exe) }))
  }
}

function rateOf(day: DayRollup | null): number {
  if (day === null || shotsOf(day).length === 0) return 0
  return day.verdict.cutRate
}

/** 与 fmtMinutes 同一个取整口径：差值才能与两侧读数对得上。 */
function roundedActiveMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.max(1, Math.round(ms / 60_000)) * 60_000
}

function countText(value: number): string {
  return String(Math.max(0, Math.round(value)))
}

export function compareDays(a: DayRollup | null, b: DayRollup | null): CompareResult {
  const left = sideOf(a)
  const right = sideOf(b)
  const both = !left.empty && !right.empty
  const shotsLeft = shotsOf(a).length
  const shotsRight = shotsOf(b).length
  const diff: CompareDiffItem[] = [
    {
      label: '活跃时长',
      current: left.empty ? '—' : fmtMinutes(roundedActiveMs(a?.activeMs ?? 0)),
      previous: right.empty ? '—' : fmtMinutes(roundedActiveMs(b?.activeMs ?? 0)),
      delta: both ? roundedActiveMs(a?.activeMs ?? 0) - roundedActiveMs(b?.activeMs ?? 0) : null,
      unit: 'ms'
    },
    {
      label: '镜头数',
      current: left.empty ? '—' : countText(shotsLeft),
      previous: right.empty ? '—' : countText(shotsRight),
      delta: both ? shotsLeft - shotsRight : null,
      unit: 'count'
    },
    {
      label: '每小时剪辑',
      current: left.empty ? '—' : rateOf(a).toFixed(1),
      previous: right.empty ? '—' : rateOf(b).toFixed(1),
      delta: both ? Math.round((rateOf(a) - rateOf(b)) * 10) / 10 : null,
      unit: 'rate'
    }
  ]
  return { left, right, diff }
}

/** 差异列的文案：只描述变化，不评价；数值带单位。 */
export function formatDelta(item: CompareDiffItem): string {
  if (item.delta === null) return '—'
  const flat = item.unit === 'rate' ? Math.abs(item.delta) < 0.05 : Math.abs(item.delta) < 0.5
  if (flat) return '持平'
  const sign = item.delta > 0 ? '+' : '−'
  if (item.unit === 'ms') return `${sign}${fmtMinutes(Math.abs(item.delta))}`
  if (item.unit === 'count') return `${sign}${Math.round(Math.abs(item.delta))} 个`
  return `${sign}${Math.abs(item.delta).toFixed(1)} 次/小时`
}

/** 正负分别上暖色/银色；持平与无数据都不上色。 */
export function deltaDirection(item: CompareDiffItem): 'up' | 'down' | 'flat' | 'none' {
  if (item.delta === null) return 'none'
  const flat = item.unit === 'rate' ? Math.abs(item.delta) < 0.05 : Math.abs(item.delta) < 0.5
  if (flat) return 'flat'
  return item.delta > 0 ? 'up' : 'down'
}
