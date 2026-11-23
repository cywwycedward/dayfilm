import { describe, expect, test } from 'vitest'
import {
  SELECT_PANEL_MARGIN,
  initialHighlight,
  moveHighlight,
  panelPlacement
} from '../../src/renderer/src/lib/select'

describe('下拉框高亮', () => {
  test('打开时高亮选中项，越界夹到两端', () => {
    expect(initialHighlight(2, 5)).toBe(2)
    expect(initialHighlight(-1, 5)).toBe(0)
    expect(initialHighlight(9, 5)).toBe(4)
    expect(initialHighlight(0, 0)).toBe(-1)
  })

  test('↑↓ 循环移动', () => {
    expect(moveHighlight(0, 'ArrowDown', 3)).toBe(1)
    expect(moveHighlight(2, 'ArrowDown', 3)).toBe(0)
    expect(moveHighlight(0, 'ArrowUp', 3)).toBe(2)
    expect(moveHighlight(-1, 'ArrowDown', 3)).toBe(0)
    expect(moveHighlight(-1, 'ArrowUp', 3)).toBe(2)
  })

  test('Home / End 到两端，其它键不动', () => {
    expect(moveHighlight(1, 'Home', 4)).toBe(0)
    expect(moveHighlight(1, 'End', 4)).toBe(3)
    expect(moveHighlight(1, 'Enter', 4)).toBe(1)
    expect(moveHighlight(1, 'a', 4)).toBe(1)
  })

  test('空列表没有高亮', () => {
    expect(moveHighlight(-1, 'ArrowDown', 0)).toBe(-1)
    expect(moveHighlight(0, 'End', 0)).toBe(-1)
  })
})

describe('下拉面板朝向', () => {
  const viewport = 800

  test('下方放得下就朝下', () => {
    expect(panelPlacement({ top: 50, bottom: 82 }, 260, viewport)).toBe('down')
  })

  test('下方放不下、上方放得下就朝上', () => {
    expect(panelPlacement({ top: 600, bottom: 632 }, 260, viewport)).toBe('up')
  })

  test('两边都放不下时选空间大的一边', () => {
    const tight = panelPlacement({ top: 300, bottom: 332 }, 600, 720)
    const above = 300 - SELECT_PANEL_MARGIN
    const below = 720 - 332 - SELECT_PANEL_MARGIN
    expect(tight).toBe(below >= above ? 'down' : 'up')
  })

  test('边距参与计算', () => {
    // 下方正好 260 可用（800-532-8），再少 1px 就翻上
    expect(panelPlacement({ top: 500, bottom: 532 }, 260, viewport)).toBe('down')
    expect(panelPlacement({ top: 500, bottom: 533 }, 260, viewport)).toBe('up')
  })
})
