import { describe, expect, it } from 'vitest'
import { HUD_HEIGHT, HUD_WIDTH } from '../../src/main/hud'
import {
  HUD_MARGIN,
  defaultHudPosition,
  isHudPositionVisible,
  resolveHudPosition,
  type HudRect
} from '../../src/main/hud/position'

const SIZE = { width: HUD_WIDTH, height: HUD_HEIGHT }
const PRIMARY: HudRect = { x: 0, y: 0, width: 1920, height: 1080 }
const SECOND: HudRect = { x: 1920, y: 0, width: 1280, height: 1024 }

describe('defaultHudPosition', () => {
  it('工作区右上角，距边缘 24px', () => {
    const position = defaultHudPosition(PRIMARY, SIZE)
    expect(position).toEqual({ x: 1920 - HUD_WIDTH - HUD_MARGIN, y: HUD_MARGIN })
    expect(position.x).toBe(1536)
    expect(position.y).toBe(24)
  })

  it('带偏移的工作区（任务栏、非主显示器原点）', () => {
    const area: HudRect = { x: -1920, y: 40, width: 1920, height: 1000 }
    // -1920 + 1920 - 360 - 24 = -384，y = 40 + 24
    expect(defaultHudPosition(area, SIZE)).toEqual({ x: -384, y: 64 })
  })
})

describe('isHudPositionVisible', () => {
  it('完全落在工作区里算可见', () => {
    expect(isHudPositionVisible({ x: 100, y: 100 }, SIZE, [PRIMARY])).toBe(true)
  })

  it('完全跑到屏幕外算不可见', () => {
    expect(isHudPositionVisible({ x: 5000, y: 5000 }, SIZE, [PRIMARY])).toBe(false)
    expect(isHudPositionVisible({ x: -400, y: 0 }, SIZE, [PRIMARY])).toBe(false)
  })

  it('只露一条边不算可见', () => {
    // 只剩 10px 在屏幕内：不够拖动
    expect(isHudPositionVisible({ x: 1920 - 10, y: 100 }, SIZE, [PRIMARY])).toBe(false)
    expect(isHudPositionVisible({ x: 1920 - 60, y: 100 }, SIZE, [PRIMARY])).toBe(true)
  })

  it('落在第二块显示器上也算可见', () => {
    expect(isHudPositionVisible({ x: 2000, y: 200 }, SIZE, [PRIMARY, SECOND])).toBe(true)
  })

  it('没有任何显示器信息时不可见', () => {
    expect(isHudPositionVisible({ x: 100, y: 100 }, SIZE, [])).toBe(false)
  })
})

describe('resolveHudPosition', () => {
  it('没拖过（null）用默认位置', () => {
    expect(resolveHudPosition({ x: null, y: null }, SIZE, [PRIMARY], PRIMARY)).toEqual(
      defaultHudPosition(PRIMARY, SIZE)
    )
  })

  it('拖过的位置还在屏幕上就沿用', () => {
    expect(resolveHudPosition({ x: 300, y: 200 }, SIZE, [PRIMARY, SECOND], PRIMARY)).toEqual({ x: 300, y: 200 })
    expect(resolveHudPosition({ x: 2000, y: 100 }, SIZE, [PRIMARY, SECOND], PRIMARY)).toEqual({ x: 2000, y: 100 })
  })

  it('位置落在屏幕外（换了分辨率/拔了显示器）回到默认位置', () => {
    expect(resolveHudPosition({ x: 3000, y: 100 }, SIZE, [PRIMARY], PRIMARY)).toEqual(defaultHudPosition(PRIMARY, SIZE))
    expect(resolveHudPosition({ x: 100, y: -500 }, SIZE, [PRIMARY], PRIMARY)).toEqual(defaultHudPosition(PRIMARY, SIZE))
  })

  it('只有一个坐标有值也当没拖过', () => {
    expect(resolveHudPosition({ x: 300, y: null }, SIZE, [PRIMARY], PRIMARY)).toEqual(defaultHudPosition(PRIMARY, SIZE))
    expect(resolveHudPosition({ x: null, y: 200 }, SIZE, [PRIMARY], PRIMARY)).toEqual(defaultHudPosition(PRIMARY, SIZE))
  })
})
