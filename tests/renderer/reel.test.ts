import { describe, expect, test } from 'vitest'
import type { Scene } from '../../src/shared/types'
import { layoutReel, sceneAt } from '../../src/renderer/src/lib/reel'
import { startOfDay } from '../../src/renderer/src/lib/time'

const DAY = '2025-01-15'
const HOUR = 3_600_000
const dayStart = startOfDay(DAY)

function shot(id: string, fromHour: number, toHour: number): Scene {
  return {
    id,
    start: dayStart + fromHour * HOUR,
    end: dayStart + toHour * HOUR,
    exe: 'Code',
    title: `标题 ${id}`,
    seconds: (toHour - fromHour) * 3600,
    kind: 'shot'
  }
}

describe('layoutReel', () => {
  test('00:00 → 0，24:00 → 宽度', () => {
    const [rect] = layoutReel([shot('full', 0, 24)], dayStart, 1200)
    expect(rect.x0).toBe(0)
    expect(rect.x1).toBe(1200)
  })

  test('宽度按真实时长比例', () => {
    const rects = layoutReel([shot('a', 0, 6), shot('b', 6, 12), shot('c', 12, 24)], dayStart, 960)
    expect(rects.map((rect) => rect.x1 - rect.x0)).toEqual([240, 240, 480])
    expect(rects[1].x0).toBe(240)
    expect(rects[2].x1).toBe(960)
  })

  test('空数据与零宽度返回空数组，不产生 NaN', () => {
    expect(layoutReel([], dayStart, 800)).toEqual([])
    expect(layoutReel([shot('a', 0, 1)], dayStart, 0)).toEqual([])
    expect(layoutReel([shot('a', 0, 1)], dayStart, Number.NaN)).toEqual([])
  })

  test('时间戳非法的镜头被跳过', () => {
    const broken: Scene = { ...shot('bad', 0, 1), start: Number.NaN, end: Number.NaN }
    expect(layoutReel([broken], dayStart, 800)).toEqual([])
    const mixed = layoutReel([broken, shot('ok', 2, 3)], dayStart, 800)
    expect(mixed).toHaveLength(1)
    expect(Number.isFinite(mixed[0].x0)).toBe(true)
  })

  test('跨日的镜头夹取到边界内', () => {
    const [rect] = layoutReel([shot('wide', -6, 30)], dayStart, 600)
    expect(rect.x0).toBe(0)
    expect(rect.x1).toBe(600)
  })
})

describe('sceneAt', () => {
  const scenes = [shot('a', 9, 10), shot('b', 10, 11)]

  test('落在镜头内', () => {
    expect(sceneAt(dayStart + 9.5 * HOUR, scenes)?.id).toBe('a')
    expect(sceneAt(dayStart + 10.75 * HOUR, scenes)?.id).toBe('b')
  })

  test('左闭右开：起点命中，终点落空', () => {
    expect(sceneAt(dayStart + 9 * HOUR, scenes)?.id).toBe('a')
    expect(sceneAt(dayStart + 11 * HOUR, scenes)).toBeNull()
  })

  test('间隙与空集合返回 null', () => {
    expect(sceneAt(dayStart + 8 * HOUR, scenes)).toBeNull()
    expect(sceneAt(0, [])).toBeNull()
  })
})

describe('sceneAt 间隙', () => {
  const scenes = [shot('a', 9, 10), shot('b', 11, 12)]

  test('间隙不冒充前后镜头', () => {
    expect(sceneAt(dayStart + 10.5 * HOUR, scenes)).toBeNull()
  })
})
