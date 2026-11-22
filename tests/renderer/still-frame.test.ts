import { describe, expect, test } from 'vitest'
import {
  FULL_MIN_HEIGHT,
  FULL_MIN_WIDTH,
  grainPoints,
  shotOrdinals,
  stillParams,
  stillTier
} from '../../src/renderer/src/lib/still-frame'

const DATE = '2026-11-22'

function full(overrides: Partial<Parameters<typeof stillParams>[0]> = {}) {
  return stillParams({
    exe: 'Code',
    title: 'dayfilm - Visual Studio Code',
    kind: 'shot',
    index: 7,
    date: DATE,
    width: 512,
    height: 288,
    ...overrides
  })
}

describe('剧照档位', () => {
  test('按尺寸选档：完整帧 / 紧凑帧 / 细缝', () => {
    expect(stillTier(FULL_MIN_WIDTH, FULL_MIN_HEIGHT)).toBe('full')
    expect(stillTier(FULL_MIN_WIDTH - 1, FULL_MIN_HEIGHT)).toBe('compact')
    expect(stillTier(400, FULL_MIN_HEIGHT - 1)).toBe('compact')
    expect(stillTier(56, 40)).toBe('compact')
    expect(stillTier(55, 40)).toBe('sliver')
    expect(stillTier(30, 200)).toBe('sliver')
  })
})

describe('完整帧参数', () => {
  test('矮帧用 18px 应用名，高帧用 24px', () => {
    expect(full({ width: 200, height: 64 }).lines[0].size).toBe(18)
    expect(full({ width: 512, height: 288 }).lines[0].size).toBe(24)
  })

  test('应用名、标题、时间码、镜次都在，字号为整数', () => {
    const params = full()
    expect(params.lines.map((line) => line.family)).toEqual(['display', 'ui', 'mono', 'mono'])
    for (const line of params.lines) {
      expect(Number.isInteger(line.size)).toBe(true)
      expect(line.size).toBeGreaterThan(0)
    }
    expect(params.lines[0].text).toBe('CODE')
    expect(params.lines[1].text).toBe('dayfilm - Visual Studio Code')
    expect(params.lines[3].text).toBe('#07')
  })

  test('齿孔上下各一条带，位置在画面内', () => {
    const params = full()
    expect(params.bandTop).toBe(5)
    expect(params.bandBottom).toBe(5)
    expect(params.holes.length).toBeGreaterThan(10)
    for (const hole of params.holes) {
      expect(hole.x).toBeGreaterThanOrEqual(0)
      expect(hole.x + hole.w).toBeLessThanOrEqual(512)
      expect(hole.y).toBeGreaterThanOrEqual(0)
      expect(hole.y + hole.h).toBeLessThanOrEqual(288)
    }
  })

  test('族色边条、颗粒、描边都有，族色来自进程名', () => {
    const params = full()
    expect(params.sideBar).toEqual({ w: 3, visible: true })
    expect(params.grain?.count).toBeGreaterThan(100)
    expect(params.border).toBe(true)
    expect(params.hue).toBeGreaterThanOrEqual(0)
    expect(params.hue).toBeLessThan(360)
  })

  test('中场休息：不画族色条与齿孔，改斜纹，写中场休息', () => {
    const params = full({ kind: 'intermission', index: 0 })
    expect(params.sideBar?.visible).toBe(false)
    expect(params.holes).toEqual([])
    expect(params.bandTop).toBe(0)
    expect(params.hatch).not.toBeNull()
    expect(params.grain).toBeNull()
    expect(params.lines[0].text).toBe('中场休息')
    expect(params.lines.some((line) => line.text === '#00')).toBe(false)
  })
})

describe('紧凑帧与细缝', () => {
  test('紧凑帧只有族色顶条、应用名与镜次', () => {
    const params = stillParams({
      exe: 'chrome',
      title: 'GitHub',
      kind: 'shot',
      index: 3,
      date: DATE,
      width: 64,
      height: 36
    })
    expect(params.tier).toBe('compact')
    expect(params.topBar).toEqual({ h: 2, visible: true })
    expect(params.holes).toEqual([])
    expect(params.grain).toBeNull()
    expect(params.lines[0].text).toBe('CHROME')
    expect(params.lines[1].text).toBe('#03')
  })

  test('应用名字号按宽度在 12–16 之间', () => {
    const narrow = stillParams({ exe: 'Code', title: 't', kind: 'shot', index: 1, date: DATE, width: 56, height: 40 })
    const wide = stillParams({ exe: 'Code', title: 't', kind: 'shot', index: 1, date: DATE, width: 400, height: 40 })
    expect(narrow.lines[0].size).toBe(12)
    expect(wide.lines[0].size).toBe(16)
  })

  test('细缝没有文字、没有边条', () => {
    const params = stillParams({ exe: 'Code', title: 'x', kind: 'shot', index: 5, date: DATE, width: 30, height: 96 })
    expect(params.tier).toBe('sliver')
    expect(params.lines).toEqual([])
    expect(params.sideBar).toBeNull()
    expect(params.topBar).toBeNull()
    expect(params.sliver).toEqual({ fillAlpha: 0.35, highlightH: 2 })
  })
})

describe('确定性', () => {
  test('同一输入完全一致', () => {
    expect(full()).toEqual(full())
  })

  test('颗粒种子由日期与镜次参与', () => {
    expect(full().seed).not.toBe(full({ date: '2026-11-21' }).seed)
    expect(full().seed).not.toBe(full({ index: 8 }).seed)
  })

  test('颗粒点可重现且落在画面内', () => {
    const first = grainPoints(12345, 50, 200, 100)
    const second = grainPoints(12345, 50, 200, 100)
    expect(first).toEqual(second)
    for (const point of first) {
      expect(point.x).toBeGreaterThanOrEqual(0)
      expect(point.x).toBeLessThan(200)
      expect(point.y).toBeGreaterThanOrEqual(0)
      expect(point.y).toBeLessThan(100)
      expect(point.a).toBeGreaterThan(0)
    }
  })
})

describe('镜次', () => {
  test('只数镜头，中场休息不占号', () => {
    const ordinals = shotOrdinals([
      { id: 'a', kind: 'shot' },
      { id: 'r', kind: 'intermission' },
      { id: 'b', kind: 'shot' },
      { id: 'c', kind: 'shot' }
    ])
    expect(ordinals.get('a')).toBe(1)
    expect(ordinals.has('r')).toBe(false)
    expect(ordinals.get('b')).toBe(2)
    expect(ordinals.get('c')).toBe(3)
  })

  test('空数组得到空表', () => {
    expect(shotOrdinals([]).size).toBe(0)
  })
})
