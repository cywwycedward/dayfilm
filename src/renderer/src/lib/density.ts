/**
 * 素材密度：把一天切成 10 分钟一桶，画出"什么时候有素材"的直方图。
 * 与胶片共用同一个视窗（{ startMs, spanMs }），缩放平移时同步。
 */
import type { Scene } from '../../../shared/types'

const DAY_MS = 86_400_000
export const DENSITY_BUCKETS = 144
export const DENSITY_BUCKET_MS = 600_000

/** 每桶的活跃占比 0–1（非空闲镜头秒数 / 桶长）。中场休息不算素材。 */
export function dayDensity(
  scenes: readonly Scene[],
  dayStart: number,
  bucketCount = DENSITY_BUCKETS
): number[] {
  const count = Math.max(1, Math.floor(bucketCount))
  const bucketMs = DAY_MS / count
  const buckets = new Array<number>(count).fill(0)
  const dayEnd = dayStart + DAY_MS
  for (const scene of scenes) {
    if (scene.kind !== 'shot') continue
    if (!Number.isFinite(scene.start) || !Number.isFinite(scene.end)) continue
    let cursor = Math.max(dayStart, Math.min(scene.start, scene.end))
    const stop = Math.min(dayEnd, Math.max(scene.start, scene.end))
    while (cursor < stop) {
      const index = Math.min(count - 1, Math.max(0, Math.floor((cursor - dayStart) / bucketMs)))
      const bucketEnd = dayStart + (index + 1) * bucketMs
      const slice = Math.min(stop, bucketEnd) - cursor
      if (!(slice > 0)) break
      buckets[index] += slice
      cursor = bucketEnd
    }
  }
  return buckets.map((ms) => Math.min(1, ms / bucketMs))
}

export interface DensityBar {
  index: number
  x0: number
  x1: number
  level: number
  /** 该桶完全没有素材（画 2px 底纹） */
  empty: boolean
}

/** 视窗内可见的桶，坐标与胶片完全一致。 */
export function densityBars(
  buckets: readonly number[],
  view: { startMs: number; spanMs: number },
  width: number,
  dayStart: number
): DensityBar[] {
  if (!(width > 0) || !(view.spanMs > 0) || buckets.length === 0) return []
  const bucketMs = DAY_MS / buckets.length
  const viewEnd = view.startMs + view.spanMs
  const bars: DensityBar[] = []
  for (let index = 0; index < buckets.length; index += 1) {
    const start = dayStart + index * bucketMs
    const end = start + bucketMs
    if (end <= view.startMs || start >= viewEnd) continue
    const x0 = ((Math.max(start, view.startMs) - view.startMs) / view.spanMs) * width
    const x1 = ((Math.min(end, viewEnd) - view.startMs) / view.spanMs) * width
    bars.push({ index, x0, x1, level: buckets[index], empty: buckets[index] <= 0 })
  }
  return bars
}
