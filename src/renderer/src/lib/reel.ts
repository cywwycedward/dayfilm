/**
 * 胶片时间轴布局。全天 00:00–24:00 的情况在这里；
 * 缩放视窗的通用版本在 lib/zoom.ts，两边共用同一份实现。
 */
import type { Scene } from '../../../shared/types'
import { DAY_MS, layoutInView, type ReelRect } from './zoom'

export type { ReelRect } from './zoom'

/**
 * 按真实时长比例铺开镜头。宽度不做最小像素补偿：
 * 比例必须是真的，可见性由绘制层处理。
 */
export function layoutReel(scenes: readonly Scene[], dayStart: number, width: number): ReelRect[] {
  return layoutInView(scenes, { startMs: dayStart, spanMs: DAY_MS }, width)
}

/** 时间戳落在哪个镜头内（含左端点，不含右端点）。 */
export function sceneAt(ts: number, scenes: readonly Scene[]): Scene | null {
  for (const scene of scenes) {
    if (ts >= scene.start && ts < scene.end) return scene
  }
  return null
}
