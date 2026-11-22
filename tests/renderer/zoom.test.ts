import { describe, expect, test } from 'vitest'
import type { Scene } from '../../src/shared/types'
import {
  DAY_MS,
  MAX_ZOOM,
  MIN_SPAN_MS,
  clampView,
  ensureVisible,
  fractionInView,
  fullDay,
  layoutInView,
  offsetInView,
  panBy,
  tickStepMs,
  ticksInView,
  zoomAt,
  zoomLevel
} from '../../src/renderer/src/lib/zoom'
import { startOfDay } from '../../src/renderer/src/lib/time'

const DAY = '2025-01-15'
const HOUR = 3_600_000
const MINUTE = 60_000
const dayStart = startOfDay(DAY)

function shot(id: string, fromHour: number, toHour: number): Scene {
  return {
    id,
    start: dayStart + fromHour * HOUR,
    end: dayStart + toHour * HOUR,
    exe: 'Code',
    title: id,
    seconds: (toHour - fromHour) * 3600,
    kind: 'shot'
  }
}

describe('视窗夹紧', () => {
  test('全天视窗就是 24 小时', () => {
    expect(fullDay(dayStart)).toEqual({ startMs: dayStart, spanMs: DAY_MS })
    expect(zoomLevel(fullDay(dayStart))).toBe(1)
  })

  test('跨度夹在 30 分钟–24 小时', () => {
    expect(clampView({ startMs: dayStart, spanMs: MINUTE }, dayStart).spanMs).toBe(MIN_SPAN_MS)
    expect(clampView({ startMs: dayStart, spanMs: DAY_MS * 3 }, dayStart).spanMs).toBe(DAY_MS)
    expect(zoomLevel({ startMs: dayStart, spanMs: MIN_SPAN_MS })).toBe(MAX_ZOOM)
  })

  test('起点夹在 0:00–24:00 之内', () => {
    expect(clampView({ startMs: dayStart - HOUR, spanMs: HOUR }, dayStart).startMs).toBe(dayStart)
    const late = clampView({ startMs: dayStart + DAY_MS, spanMs: HOUR }, dayStart)
    expect(late.startMs).toBe(dayStart + DAY_MS - HOUR)
  })

  test('非法输入不产生 NaN', () => {
    const view = clampView({ startMs: Number.NaN, spanMs: Number.NaN }, dayStart)
    expect(Number.isFinite(view.startMs)).toBe(true)
    expect(Number.isFinite(view.spanMs)).toBe(true)
  })
})

describe('缩放锚点', () => {
  test('锚点时刻在视窗里的相对位置保持不变', () => {
    const view = { startMs: dayStart + 8 * HOUR, spanMs: 4 * HOUR }
    const anchor = dayStart + 9 * HOUR
    const before = fractionInView(anchor, view)
    const zoomed = zoomAt(view, 2, anchor, dayStart)
    expect(fractionInView(anchor, zoomed)).toBeCloseTo(before, 6)
    expect(zoomed.spanMs).toBe(2 * HOUR)
    expect(zoomLevel(zoomed)).toBe(12)
  })

  test('放大到顶就停在 30 分钟，不越界', () => {
    let view = fullDay(dayStart)
    for (let i = 0; i < 30; i += 1) view = zoomAt(view, 2, dayStart + 12 * HOUR, dayStart)
    expect(view.spanMs).toBe(MIN_SPAN_MS)
    expect(view.startMs).toBeGreaterThanOrEqual(dayStart)
    expect(view.startMs + view.spanMs).toBeLessThanOrEqual(dayStart + DAY_MS)
  })

  test('缩小回 24 小时', () => {
    const view = zoomAt({ startMs: dayStart + 6 * HOUR, spanMs: HOUR }, 0.01, dayStart + 6.5 * HOUR, dayStart)
    expect(view.spanMs).toBe(DAY_MS)
    expect(view.startMs).toBe(dayStart)
  })

  test('贴着 0:00 放大时锚点仍在视窗内', () => {
    const anchor = dayStart + 10 * MINUTE
    const view = zoomAt(fullDay(dayStart), 8, anchor, dayStart)
    expect(view.startMs).toBeGreaterThanOrEqual(dayStart)
    expect(anchor).toBeGreaterThanOrEqual(view.startMs)
    expect(anchor).toBeLessThanOrEqual(view.startMs + view.spanMs)
    // 锚点在视窗里的相对位置与缩放前一致
    expect(fractionInView(anchor, view)).toBeCloseTo(fractionInView(anchor, fullDay(dayStart)), 6)
  })
})

describe('平移', () => {
  test('往右平移到头会被夹住', () => {
    const view = panBy({ startMs: dayStart, spanMs: 2 * HOUR }, -5 * HOUR, dayStart)
    expect(view.startMs).toBe(dayStart)
  })

  test('往左平移不会越过 24:00', () => {
    const view = panBy({ startMs: dayStart, spanMs: 2 * HOUR }, 30 * HOUR, dayStart)
    expect(view.startMs + view.spanMs).toBe(dayStart + DAY_MS)
  })

  test('平移不改变跨度', () => {
    const view = panBy({ startMs: dayStart + HOUR, spanMs: 3 * HOUR }, 2 * HOUR, dayStart)
    expect(view.spanMs).toBe(3 * HOUR)
    expect(view.startMs).toBe(dayStart + 3 * HOUR)
  })
})

describe('刻度', () => {
  test('按可见跨度选步长', () => {
    expect(tickStepMs(DAY_MS)).toBe(6 * HOUR)
    expect(tickStepMs(12 * HOUR + 1)).toBe(6 * HOUR)
    // 刚好 12 小时走“> 3 小时”那一档
    expect(tickStepMs(12 * HOUR)).toBe(HOUR)
    expect(tickStepMs(6 * HOUR)).toBe(HOUR)
    expect(tickStepMs(3 * HOUR)).toBe(15 * MINUTE)
    expect(tickStepMs(2 * HOUR)).toBe(15 * MINUTE)
    expect(tickStepMs(HOUR)).toBe(5 * MINUTE)
    expect(tickStepMs(MIN_SPAN_MS)).toBe(5 * MINUTE)
  })

  test('刻度点落在视窗内且按步长对齐', () => {
    const view = { startMs: dayStart + 7.2 * HOUR, spanMs: 2 * HOUR }
    const step = tickStepMs(view.spanMs)
    const ticks = ticksInView(view)
    expect(ticks.length).toBeGreaterThan(2)
    for (const tick of ticks) {
      expect(tick % step).toBe(0)
      expect(tick).toBeGreaterThanOrEqual(view.startMs)
      expect(tick).toBeLessThanOrEqual(view.startMs + view.spanMs)
    }
  })

  test('全天视窗给出 0/6/12/18/24 五个点', () => {
    expect(ticksInView(fullDay(dayStart)).map((t) => (t - dayStart) / HOUR)).toEqual([0, 6, 12, 18, 24])
  })
})

describe('布局映射', () => {
  test('1x 与全天比例一致', () => {
    const rects = layoutInView([shot('a', 0, 6), shot('b', 12, 18)], fullDay(dayStart), 960)
    expect(rects.map((rect) => [rect.x0, rect.x1])).toEqual([
      [0, 240],
      [480, 720]
    ])
  })

  test('放大 2x 后同样的镜头变宽一倍', () => {
    const view = { startMs: dayStart, spanMs: 12 * HOUR }
    const [rect] = layoutInView([shot('a', 0, 6)], view, 960)
    expect(rect.x0).toBe(0)
    expect(rect.x1).toBe(480)
  })

  test('视窗之外的镜头被丢掉，跨界的被裁到边缘', () => {
    const view = { startMs: dayStart + 4 * HOUR, spanMs: 4 * HOUR }
    const rects = layoutInView([shot('before', 0, 3), shot('overlap', 3, 6), shot('after', 10, 12)], view, 800)
    expect(rects.map((rect) => rect.scene.id)).toEqual(['overlap'])
    expect(rects[0].x0).toBe(0)
    expect(rects[0].x1).toBe(400)
  })

  test('零宽度与非有限时间戳不产生 NaN', () => {
    expect(layoutInView([shot('a', 0, 1)], fullDay(dayStart), 0)).toEqual([])
    const broken: Scene = { ...shot('bad', 0, 1), start: Number.NaN, end: Number.NaN }
    expect(layoutInView([broken], fullDay(dayStart), 800)).toEqual([])
  })

  test('偏移与比例是线性的', () => {
    const view = { startMs: dayStart + 2 * HOUR, spanMs: 4 * HOUR }
    expect(offsetInView(dayStart + 2 * HOUR, view, 800)).toBe(0)
    expect(offsetInView(dayStart + 4 * HOUR, view, 800)).toBe(400)
    expect(offsetInView(dayStart + 6 * HOUR, view, 800)).toBe(800)
    expect(fractionInView(dayStart + 4 * HOUR, view)).toBe(0.5)
  })
})

describe('选中保证可见', () => {
  test('已经看得见就不动', () => {
    const view = { startMs: dayStart + 8 * HOUR, spanMs: 2 * HOUR }
    expect(ensureVisible(view, dayStart + 8.5 * HOUR, dayStart + 9 * HOUR, dayStart)).toEqual(view)
  })

  test('看不见时把镜头挪进视窗', () => {
    const view = { startMs: dayStart + 8 * HOUR, spanMs: 2 * HOUR }
    const next = ensureVisible(view, dayStart + 15 * HOUR, dayStart + 15.5 * HOUR, dayStart)
    expect(dayStart + 15 * HOUR).toBeGreaterThanOrEqual(next.startMs)
    expect(dayStart + 15.5 * HOUR).toBeLessThanOrEqual(next.startMs + next.spanMs)
  })

  test('比视窗还长的镜头会放大视窗', () => {
    const view = { startMs: dayStart + 8 * HOUR, spanMs: MIN_SPAN_MS }
    const next = ensureVisible(view, dayStart + 9 * HOUR, dayStart + 10 * HOUR, dayStart)
    expect(next.spanMs).toBeGreaterThanOrEqual(HOUR)
  })
})
