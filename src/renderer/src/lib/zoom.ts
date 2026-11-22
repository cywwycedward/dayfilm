/**
 * 胶片视窗：缩放与平移的纯函数。
 * 视窗只描述"看哪一段"（{ startMs, spanMs }），不读时钟也不碰 DOM。
 */
import type { Scene } from '../../../shared/types'

export const DAY_MS = 86_400_000
/** 最小视窗 30 分钟，对应 48x */
export const MIN_SPAN_MS = 30 * 60_000
export const MAX_ZOOM = 48

export interface TimeView {
  startMs: number
  spanMs: number
}

export interface ReelRect {
  scene: Scene
  /** 左边界，像素 */
  x0: number
  /** 右边界，像素 */
  x1: number
}

export function fullDay(dayStart: number): TimeView {
  return { startMs: dayStart, spanMs: DAY_MS }
}

/** 跨度夹到 30 分钟–24 小时，起点夹到 0:00–24:00 之内。 */
export function clampView(view: TimeView, dayStart: number): TimeView {
  const span = Math.min(DAY_MS, Math.max(MIN_SPAN_MS, Number.isFinite(view.spanMs) ? view.spanMs : DAY_MS))
  const rawStart = Number.isFinite(view.startMs) ? view.startMs : dayStart
  const maxStart = dayStart + DAY_MS - span
  return { startMs: Math.min(maxStart, Math.max(dayStart, rawStart)), spanMs: span }
}

/** 1x–48x。 */
export function zoomLevel(view: TimeView): number {
  if (!(view.spanMs > 0)) return 1
  return Math.min(MAX_ZOOM, Math.max(1, DAY_MS / view.spanMs))
}

/** 以某个时刻为锚点缩放：锚点保持在原来的相对位置。 */
export function zoomAt(view: TimeView, factor: number, anchorMs: number, dayStart: number): TimeView {
  const current = clampView(view, dayStart)
  if (!Number.isFinite(factor) || factor <= 0) return current
  const span = Math.min(DAY_MS, Math.max(MIN_SPAN_MS, current.spanMs / factor))
  const ratio = span / current.spanMs
  const anchor = Number.isFinite(anchorMs) ? anchorMs : current.startMs + current.spanMs / 2
  return clampView({ startMs: anchor - (anchor - current.startMs) * ratio, spanMs: span }, dayStart)
}

export function panBy(view: TimeView, deltaMs: number, dayStart: number): TimeView {
  const current = clampView(view, dayStart)
  if (!Number.isFinite(deltaMs)) return current
  return clampView({ startMs: current.startMs + deltaMs, spanMs: current.spanMs }, dayStart)
}

/** 刻度步长自适应：>12h 6 小时、>3h 1 小时、>1h 15 分钟、否则 5 分钟。 */
export function tickStepMs(spanMs: number): number {
  if (spanMs > 12 * 3_600_000) return 6 * 3_600_000
  if (spanMs > 3 * 3_600_000) return 3_600_000
  if (spanMs > 3_600_000) return 15 * 60_000
  return 5 * 60_000
}

/** 视窗内的刻度时刻。对齐到本地时间轴（当地 0/6/12/18 点），不是对齐 epoch。 */
export function ticksInView(view: TimeView, stepMs?: number): number[] {
  const step = stepMs ?? tickStepMs(view.spanMs)
  if (!(step > 0) || !Number.isFinite(step)) return []
  const end = view.startMs + view.spanMs
  const out: number[] = []
  for (let t = firstLocalTick(view.startMs, step); t <= end && out.length < 240; t += step) {
    out.push(t)
  }
  return out
}

/** 不早于 ts 的第一个本地刻度（本地零点起按步长对齐，不是对齐 epoch）。 */
function firstLocalTick(ts: number, stepMs: number): number {
  const stepMinutes = Math.round(stepMs / 60_000)
  if (stepMinutes < 60) {
    const base = new Date(ts)
    base.setMinutes(0, 0, 0)
    let tick = base.getTime()
    while (tick < ts) tick += stepMinutes * 60_000
    return tick
  }
  const stepHours = Math.max(1, Math.round(stepMinutes / 60))
  const midnight = new Date(ts)
  midnight.setHours(0, 0, 0, 0)
  const base = midnight.getTime()
  const hours = (ts - base) / 3_600_000
  let slot = Math.ceil(hours / stepHours) * stepHours
  let tick = base + slot * 3_600_000
  if (tick < ts) {
    slot += stepHours
    tick = base + slot * 3_600_000
  }
  return tick
}

/** 时刻 → 视窗内的像素位置（可越界，调用方自行夹取）。 */
export function offsetInView(ts: number, view: TimeView, width: number): number {
  if (!(view.spanMs > 0)) return 0
  return ((ts - view.startMs) / view.spanMs) * width
}

export function fractionInView(ts: number, view: TimeView): number {
  if (!(view.spanMs > 0)) return 0
  return (ts - view.startMs) / view.spanMs
}

/** 只铺出与视窗相交的镜头；比例是真的，两端按视窗裁掉。 */
export function layoutInView(
  scenes: readonly Scene[],
  view: TimeView,
  width: number
): ReelRect[] {
  if (scenes.length === 0 || !(width > 0) || !(view.spanMs > 0)) return []
  const end = view.startMs + view.spanMs
  const rects: ReelRect[] = []
  for (const scene of scenes) {
    if (!Number.isFinite(scene.start) || !Number.isFinite(scene.end)) continue
    const from = Math.min(scene.start, scene.end)
    const to = Math.max(scene.start, scene.end)
    if (to <= view.startMs || from >= end) continue
    const x0 = Math.max(0, Math.min(width, offsetInView(from, view, width)))
    const x1 = Math.max(0, Math.min(width, offsetInView(to, view, width)))
    if (!Number.isFinite(x0) || !Number.isFinite(x1)) continue
    rects.push({ scene, x0, x1 })
  }
  return rects
}

/** 保证 [startMs, endMs] 落在视窗里；已经在里面就原样返回。 */
export function ensureVisible(
  view: TimeView,
  startMs: number,
  endMs: number,
  dayStart: number
): TimeView {
  const current = clampView(view, dayStart)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return current
  const from = Math.min(startMs, endMs)
  const to = Math.max(startMs, endMs)
  const visibleEnd = current.startMs + current.spanMs
  if (from >= current.startMs && to <= visibleEnd) return current
  const duration = Math.max(0, to - from)
  const span = Math.max(current.spanMs, Math.min(DAY_MS, duration))
  return clampView({ startMs: from - (span - duration) / 2, spanMs: span }, dayStart)
}

export const FIT_PADDING_MS = 10 * 60_000

/** “现在”标签靠右边缘时翻到左侧，保证整字可见。 */
export function nowLabelSide(nowX: number, labelWidth: number, width: number): 'left' | 'right' {
  if (!(width > 0) || !Number.isFinite(nowX)) return 'right'
  return nowX + Math.max(0, labelWidth) > width - 2 ? 'left' : 'right'
}

/** 适配素材：[首个镜头开始 - 10 分钟, 最后一个镜头结束 + 10 分钟]；没有镜头时等同全天。 */
export function fitView(
  firstAt: number | null,
  lastAt: number | null,
  dayStart: number,
  paddingMs = FIT_PADDING_MS
): TimeView {
  if (firstAt === null || lastAt === null) return fullDay(dayStart)
  if (!Number.isFinite(firstAt) || !Number.isFinite(lastAt)) return fullDay(dayStart)
  const from = Math.min(firstAt, lastAt)
  const to = Math.max(firstAt, lastAt)
  const span = Math.min(DAY_MS, Math.max(MIN_SPAN_MS, to - from + paddingMs * 2))
  return clampView({ startMs: from - paddingMs, spanMs: span }, dayStart)
}
