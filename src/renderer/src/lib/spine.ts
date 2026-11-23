/**
 * 胶片脊柱（DESIGN.md「脊柱」）：一天压成 144 帧 × 32px 的竖向胶片。
 * 一帧 = 10 分钟；帧里用该时段最长的一个镜头做缩略与族色，密度柱按 100 秒分 6 小格。
 */
import type { DayRollup, Scene } from '../../../shared/types'
import { exeHue } from './still'
import { startOfDay } from './time'

export const SPINE_FRAME_MS = 10 * 60_000
export const SPINE_FRAMES = 144
export const SPINE_FRAME_H = 32
/** 每帧 6 个密度小格（100 秒一格） */
export const SPINE_SUB_BUCKETS = 6
export const SPINE_SUB_MS = SPINE_FRAME_MS / SPINE_SUB_BUCKETS

export interface SpineFrame {
  index: number
  start: number
  end: number
  /** 该 10 分钟内的非空闲毫秒 */
  activeMs: number
  /** 该 10 分钟内最长的一个镜头；没有素材时 null */
  scene: Scene | null
  hue: number | null
  /** 6 个 100 秒小格的活跃度 0–1（平方根映射） */
  levels: number[]
}

export interface SpineRange {
  start: number
  end: number
}

export function spineHeight(): number {
  return SPINE_FRAMES * SPINE_FRAME_H
}

/** 100 秒的活跃时长 → 0–1。 */
export function densityLevel(activeMs: number): number {
  if (!Number.isFinite(activeMs) || activeMs <= 0) return 0
  return Math.min(1, Math.sqrt(activeMs / SPINE_SUB_MS))
}

/** 把一天的镜头摊进 144 帧；跨帧的镜头按时间切片算活跃时长。 */
export function spineFrames(day: DayRollup): SpineFrame[] {
  const base = startOfDay(day.date)
  const frames: SpineFrame[] = []
  for (let index = 0; index < SPINE_FRAMES; index += 1) {
    const start = base + index * SPINE_FRAME_MS
    const end = start + SPINE_FRAME_MS
    const buckets = new Array<number>(SPINE_SUB_BUCKETS).fill(0)
    let activeMs = 0
    let best: Scene | null = null
    let bestMs = 0
    for (const scene of day.scenes) {
      if (scene.kind !== 'shot') continue
      const from = Math.max(start, scene.start)
      const to = Math.min(end, scene.end)
      if (to <= from) continue
      activeMs += to - from
      if (to - from > bestMs) {
        bestMs = to - from
        best = scene
      }
      // 切进 100 秒小格
      let cursor = from
      while (cursor < to) {
        const bucket = Math.min(
          SPINE_SUB_BUCKETS - 1,
          Math.floor((cursor - start) / SPINE_SUB_MS)
        )
        const bucketEnd = start + (bucket + 1) * SPINE_SUB_MS
        const slice = Math.min(to, bucketEnd) - cursor
        buckets[bucket] += slice
        cursor = bucketEnd
      }
    }
    frames.push({
      index,
      start,
      end,
      activeMs,
      scene: best,
      hue: best === null ? null : exeHue(best.exe.length > 0 ? best.exe : best.title),
      levels: buckets.map((ms) => densityLevel(ms))
    })
  }
  return frames
}

/** 时刻 → 帧序号（夹在 0–143，跨零点按当天处理）。 */
export function spineFrameIndex(ts: number, date: string): number {
  const offset = ts - startOfDay(date)
  const index = Math.floor(offset / SPINE_FRAME_MS)
  return Math.min(SPINE_FRAMES - 1, Math.max(0, index))
}

/** 只画可见范围：上下各多留一帧，滚动时不会露边。 */
export function visibleSpineFrames(scrollTop: number, viewportHeight: number): SpineRange {
  const top = Math.max(0, scrollTop)
  const start = Math.max(0, Math.floor(top / SPINE_FRAME_H) - 1)
  const end = Math.min(
    SPINE_FRAMES,
    Math.ceil((top + Math.max(1, viewportHeight)) / SPINE_FRAME_H) + 1
  )
  return { start, end: Math.max(start, end) }
}

/** 让某个时刻落在脊柱视口中间。 */
export function spineScrollTop(ts: number, date: string, viewportHeight: number): number {
  const index = spineFrameIndex(ts, date)
  const center = (index + 0.5) * SPINE_FRAME_H
  return Math.max(0, Math.round(center - Math.max(1, viewportHeight) / 2))
}
