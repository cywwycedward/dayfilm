import { describe, expect, it } from 'vitest'
import { HUD_HEIGHT, HUD_WIDTH } from '../../src/main/hud'
import {
  HUD_MARGIN,
  clampToWorkAreas,
  defaultHudPosition,
  isInsideWorkArea,
  nearestWorkArea,
  resolveHudPosition,
  type HudRect
} from '../../src/main/hud/position'

const SIZE = { width: HUD_WIDTH, height: HUD_HEIGHT }
const PRIMARY: HudRect = { x: 0, y: 0, width: 1920, height: 1080 }
/** 右侧副屏（1920 是副屏原点，主屏 0..1920） */
const RIGHT: HudRect = { x: 1920, y: 0, width: 1280, height: 1024 }
/** 左侧副屏：负坐标 */
const LEFT: HudRect = { x: -1600, y: 0, width: 1600, height: 900 }

describe('defaultHudPosition', () => {
  it('工作区右上角，距边缘 24px', () => {
    expect(defaultHudPosition(PRIMARY, SIZE)).toEqual({ x: 1920 - HUD_WIDTH - HUD_MARGIN, y: HUD_MARGIN })
    expect(defaultHudPosition(PRIMARY, SIZE)).toEqual({ x: 1536, y: 24 })
  })

  it('带偏移的工作区（非主屏/任务栏）', () => {
    expect(defaultHudPosition({ x: -1920, y: 40, width: 1920, height: 1000 }, SIZE)).toEqual({ x: -384, y: 64 })
  })

  it('光标在副屏时默认放在副屏右上角', () => {
    expect(defaultHudPosition(RIGHT, SIZE)).toEqual({ x: 1920 + 1280 - HUD_WIDTH - HUD_MARGIN, y: HUD_MARGIN })
  })
})

describe('isInsideWorkArea', () => {
  it('完整落在工作区里才是 true', () => {
    expect(isInsideWorkArea({ x: 100, y: 100 }, SIZE, PRIMARY)).toBe(true)
    expect(isInsideWorkArea({ x: 1920 - HUD_WIDTH, y: 1080 - HUD_HEIGHT }, SIZE, PRIMARY)).toBe(true)
    expect(isInsideWorkArea({ x: 1920 - HUD_WIDTH + 1, y: 100 }, SIZE, PRIMARY)).toBe(false)
    expect(isInsideWorkArea({ x: -1, y: 100 }, SIZE, PRIMARY)).toBe(false)
  })

  it('负坐标副屏照样适用', () => {
    expect(isInsideWorkArea({ x: -400, y: 100 }, SIZE, LEFT)).toBe(true)
    expect(isInsideWorkArea({ x: 100, y: 100 }, SIZE, LEFT)).toBe(false)
  })
})

describe('nearestWorkArea', () => {
  it('优先选能完整容纳的工作区', () => {
    expect(nearestWorkArea({ x: 2000, y: 100 }, SIZE, [PRIMARY, RIGHT])).toBe(RIGHT)
    expect(nearestWorkArea({ x: 200, y: 100 }, SIZE, [PRIMARY, RIGHT])).toBe(PRIMARY)
  })

  it('都不完整容纳时取重叠面积最大的', () => {
    // 跨在两屏之间，大部分在右屏
    expect(nearestWorkArea({ x: 1800, y: 100 }, SIZE, [PRIMARY, RIGHT])).toBe(RIGHT)
    // 大部分在主屏
    expect(nearestWorkArea({ x: 1600, y: 100 }, SIZE, [PRIMARY, RIGHT])).toBe(PRIMARY)
  })

  it('完全不重叠时取间隙最近的', () => {
    expect(nearestWorkArea({ x: 5000, y: 100 }, SIZE, [PRIMARY, RIGHT])).toBe(RIGHT)
    expect(nearestWorkArea({ x: -3000, y: 100 }, SIZE, [PRIMARY, LEFT])).toBe(LEFT)
  })

  it('没有显示器信息时返回 null', () => {
    expect(nearestWorkArea({ x: 100, y: 100 }, SIZE, [])).toBeNull()
  })
})

describe('clampToWorkAreas', () => {
  it('单屏：完全在屏幕外时夹回屏内', () => {
    expect(clampToWorkAreas({ x: 5000, y: 5000 }, SIZE, [PRIMARY])).toEqual({
      x: 1920 - HUD_WIDTH,
      y: 1080 - HUD_HEIGHT
    })
    expect(clampToWorkAreas({ x: -300, y: -300 }, SIZE, [PRIMARY])).toEqual({ x: 0, y: 0 })
  })

  it('单屏：超出底边只夹纵向', () => {
    expect(clampToWorkAreas({ x: 200, y: 1200 }, SIZE, [PRIMARY])).toEqual({ x: 200, y: 1080 - HUD_HEIGHT })
  })

  it('负坐标副屏：在屏内就原样保留', () => {
    expect(clampToWorkAreas({ x: -400, y: 100 }, SIZE, [PRIMARY, LEFT])).toEqual({ x: -400, y: 100 })
  })

  it('负坐标副屏：拖出左边缘夹回左屏内', () => {
    expect(clampToWorkAreas({ x: -2500, y: 100 }, SIZE, [PRIMARY, LEFT])).toEqual({ x: LEFT.x, y: 100 })
  })

  it('跨屏：拖到两屏交界处夹回最近的一屏', () => {
    // 1800..2160：大部分落在右屏 → 夹进右屏左边界
    expect(clampToWorkAreas({ x: 1800, y: 100 }, SIZE, [PRIMARY, RIGHT])).toEqual({ x: 1920, y: 100 })
    // 1700..2060：大部分落在主屏 → 夹进主屏右边界
    expect(clampToWorkAreas({ x: 1700, y: 100 }, SIZE, [PRIMARY, RIGHT])).toEqual({ x: 1920 - HUD_WIDTH, y: 100 })
    // 1500..1860 完全在主屏内，搬不动
    expect(clampToWorkAreas({ x: 1500, y: 100 }, SIZE, [PRIMARY, RIGHT])).toEqual({ x: 1500, y: 100 })
  })

  it('工作区比窗口还小时贴左上角，不会出现负向夹紧', () => {
    const tiny: HudRect = { x: 10, y: 20, width: 100, height: 60 }
    expect(clampToWorkAreas({ x: 500, y: 500 }, SIZE, [tiny])).toEqual({ x: 10, y: 20 })
  })

  it('没有显示器信息时原样返回', () => {
    expect(clampToWorkAreas({ x: 5000, y: 5000 }, SIZE, [])).toEqual({ x: 5000, y: 5000 })
  })
})

describe('resolveHudPosition', () => {
  it('没拖过（null）用回退工作区的默认位置', () => {
    expect(resolveHudPosition({ x: null, y: null }, SIZE, [PRIMARY, RIGHT], RIGHT)).toEqual(defaultHudPosition(RIGHT, SIZE))
    expect(resolveHudPosition({ x: null, y: null }, SIZE, [PRIMARY], PRIMARY)).toEqual(defaultHudPosition(PRIMARY, SIZE))
  })

  it('只有一个坐标有值也当没拖过', () => {
    expect(resolveHudPosition({ x: 300, y: null }, SIZE, [PRIMARY], PRIMARY)).toEqual(defaultHudPosition(PRIMARY, SIZE))
    expect(resolveHudPosition({ x: null, y: 200 }, SIZE, [PRIMARY], PRIMARY)).toEqual(defaultHudPosition(PRIMARY, SIZE))
  })

  it('拖过的位置还在屏幕上就沿用（含负坐标副屏）', () => {
    expect(resolveHudPosition({ x: 300, y: 200 }, SIZE, [PRIMARY, RIGHT], PRIMARY)).toEqual({ x: 300, y: 200 })
    expect(resolveHudPosition({ x: 2000, y: 100 }, SIZE, [PRIMARY, RIGHT], PRIMARY)).toEqual({ x: 2000, y: 100 })
    expect(resolveHudPosition({ x: -400, y: 100 }, SIZE, [PRIMARY, LEFT], PRIMARY)).toEqual({ x: -400, y: 100 })
  })

  it('落在所有屏幕之外时夹进最近的屏幕，而不是丢回默认位置', () => {
    // 拔掉右屏后，原先在右屏的位置被夹进主屏右边界
    expect(resolveHudPosition({ x: 2500, y: 100 }, SIZE, [PRIMARY], PRIMARY)).toEqual({ x: 1920 - HUD_WIDTH, y: 100 })
    // 底部越界
    expect(resolveHudPosition({ x: 100, y: 2000 }, SIZE, [PRIMARY], PRIMARY)).toEqual({ x: 100, y: 1080 - HUD_HEIGHT })
    // 负方向越界但仍有左屏
    expect(resolveHudPosition({ x: -3000, y: 50 }, SIZE, [PRIMARY, LEFT], PRIMARY)).toEqual({ x: LEFT.x, y: 50 })
  })
})
