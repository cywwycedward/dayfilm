/**
 * 双日对比的纯参数（R51 改版：上下叠片）：两卷胶片共享一条时间轴。
 * 时间坐标一律用「离当天零点的偏移」，两天才能叠在同一条 00:00–24:00 刻度上。
 */
import type { DayRollup, Scene } from '../../../shared/types'
import { exeHue } from './still'
import { fmtMinutes, startOfDay } from './time'

export type CompareUnit = 'ms' | 'count' | 'rate'

export interface TimeRange {
  start: number
  end: number
}

export interface AxisTick {
  at: number
  label: string
}

/** 胶片带上的一段镜头：起止是离当天零点的偏移。 */
export interface CompareBlock {
  start: number
  end: number
  hue: number
}

export interface CompareSide {
  /** 当天有数据时是真实日期；空侧为空串，由界面用下拉框的日期 */
  date: string
  empty: boolean
  genre: string
  /** 带子左侧 2px 族色条：当天时长第一的进程 */
  hue: number
  blocks: CompareBlock[]
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
  /** 两条带共享的日内偏移范围；两侧都空时为 null */
  range: TimeRange | null
  ticks: AxisTick[]
}

const AXIS_TICKS = 5

function shotsOf(day: DayRollup | null): Scene[] {
  if (day === null) return []
  return day.scenes.filter((scene) => scene.kind === 'shot')
}

/** 当天某时刻 → 离当天零点的毫秒偏移。 */
function offsetOf(day: DayRollup, ts: number): number {
  return ts - startOfDay(day.date)
}

/** 一天的素材区间（首镜开始 → 末镜结束，日内偏移）；没有镜头返回 null。 */
function shotRange(day: DayRollup | null): TimeRange | null {
  const shots = shotsOf(day)
  if (day === null || shots.length === 0) return null
  const start = offsetOf(day, shots[0].start)
  const end = offsetOf(day, shots[shots.length - 1].end)
  return { start, end: Math.max(start + 1, end) }
}

/** 两条带共享的日内范围：两天的并集；任一侧空用另一侧，都空返回 null。 */
export function unionRange(a: DayRollup | null, b: DayRollup | null): TimeRange | null {
  const left = shotRange(a)
  const right = shotRange(b)
  if (left === null) return right
  if (right === null) return left
  return { start: Math.min(left.start, right.start), end: Math.max(left.end, right.end) }
}

/** 日内偏移 → HH:MM，不经过 Date，避免时区/夏令时把刻度拉歪。 */
function clockLabel(offset: number): string {
  const total = Math.max(0, Math.round(offset / 60_000))
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** 共享时间轴上的 5 个刻度；首尾就是范围两端。 */
export function axisTicks(range: TimeRange | null): AxisTick[] {
  if (range === null) return []
  const span = Math.max(1, range.end - range.start)
  const ticks: AxisTick[] = []
  for (let index = 0; index < AXIS_TICKS; index += 1) {
    const at = Math.round(range.start + (index / (AXIS_TICKS - 1)) * span)
    ticks.push({ at, label: clockLabel(at) })
  }
  return ticks
}

function blocksOf(day: DayRollup, shots: readonly Scene[]): CompareBlock[] {
  // 与海报同口径：镜头过多时抽样，绘制量可控
  const step = shots.length > 120 ? Math.ceil(shots.length / 120) : 1
  const blocks: CompareBlock[] = []
  for (let index = 0; index < shots.length; index += step) {
    const scene = shots[index]
    const start = offsetOf(day, scene.start)
    const end = offsetOf(day, scene.end)
    blocks.push({
      start,
      end: Math.max(start + 1, end),
      hue: exeHue(scene.exe.length > 0 ? scene.exe : scene.title)
    })
  }
  return blocks
}

function sideOf(day: DayRollup | null): CompareSide {
  const shots = shotsOf(day)
  if (day === null || shots.length === 0) {
    return { date: day?.date ?? '', empty: true, genre: '', hue: 0, blocks: [] }
  }
  const top = [...day.topApps].sort((a, b) => b.seconds - a.seconds)[0]
  // 左侧族色条跟着带子里最长的那一镜走，与胶片内容对得上
  const lead = day.longestShot ?? shots[0]
  const leadName = lead.exe.length > 0 ? lead.exe : lead.title
  return {
    date: day.date,
    empty: false,
    genre: day.verdict.label,
    hue: exeHue(leadName.length > 0 ? leadName : (top?.exe ?? '')),
    blocks: blocksOf(day, shots)
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
  const range = unionRange(a, b)
  return { left, right, diff, range, ticks: axisTicks(range) }
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
