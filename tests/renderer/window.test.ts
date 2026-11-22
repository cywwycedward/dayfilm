import { describe, expect, test } from 'vitest'
import { revealScrollTop, windowRange } from '../../src/renderer/src/lib/window'

const ROW = 44

describe('windowRange', () => {
  test('空列表不产生 NaN，也不渲染任何行', () => {
    expect(windowRange({ count: 0, rowHeight: ROW, scrollTop: 0, viewportHeight: 400, overscan: 5 })).toEqual({
      start: 0,
      end: 0,
      offset: 0,
      totalHeight: 0
    })
  })

  test('只有一行时全部渲染', () => {
    const range = windowRange({ count: 1, rowHeight: ROW, scrollTop: 0, viewportHeight: 400, overscan: 5 })
    expect(range.start).toBe(0)
    expect(range.end).toBe(1)
    expect(range.offset).toBe(0)
    expect(range.totalHeight).toBe(ROW)
  })

  test('顶部：可视区加下方缓冲，上方缓冲夹到 0', () => {
    const range = windowRange({ count: 600, rowHeight: ROW, scrollTop: 0, viewportHeight: 220, overscan: 5 })
    expect(range.start).toBe(0)
    expect(range.end).toBe(6 + 5) // ceil(220/44)=5，多算一行 6，再加 5 行缓冲
    expect(range.offset).toBe(0)
    expect(range.totalHeight).toBe(600 * ROW)
  })

  test('中部：上下各有 5 行缓冲', () => {
    const scrollTop = 100 * ROW
    const range = windowRange({ count: 600, rowHeight: ROW, scrollTop, viewportHeight: 220, overscan: 5 })
    expect(range.start).toBe(95)
    expect(range.end).toBe(100 + 6 + 5)
    expect(range.offset).toBe(95 * ROW)
  })

  test('滚到底：末尾不越界，最后一行一定在区间内', () => {
    const count = 600
    const totalHeight = count * ROW
    const viewport = 220
    const range = windowRange({ count, rowHeight: ROW, scrollTop: totalHeight, viewportHeight: viewport, overscan: 5 })
    expect(range.end).toBe(count)
    expect(range.start).toBeLessThanOrEqual(count - 1)
    // 底部视口装 5 行，再加 5 行缓冲
    expect(range.start).toBe(count - Math.ceil(viewport / ROW) - 5)
    expect(range.offset).toBe(range.start * ROW)
  })

  test('负的滚动位置与超界滚动都被夹住', () => {
    const base = { count: 100, rowHeight: ROW, viewportHeight: 220, overscan: 5, scrollTop: 0 }
    expect(windowRange({ ...base, scrollTop: -500 }).start).toBe(0)
    expect(windowRange({ ...base, scrollTop: 10 ** 9 }).end).toBe(100)
    expect(windowRange({ ...base, scrollTop: Number.NaN }).start).toBe(0)
    expect(windowRange({ ...base, viewportHeight: Number.NaN }).end).toBe(1 + 5)
  })

  test('行高变化时总高与偏移按新行高重算', () => {
    const scrollTop = 10 * ROW
    const input = { count: 100, scrollTop, viewportHeight: 220, overscan: 5 }
    const tall = windowRange({ ...input, rowHeight: ROW * 2 })
    const short = windowRange({ ...input, rowHeight: ROW / 2 })
    expect(tall.totalHeight).toBe(100 * ROW * 2)
    expect(short.totalHeight).toBe(100 * (ROW / 2))
    // 滚动位置以像素计，行高翻倍后同一滚动量对应的行号减半
    expect(tall.start).toBe(0)
    expect(short.start).toBe(15)
    expect(tall.offset).toBe(0)
    expect(short.offset).toBe(15 * (ROW / 2))
  })

  test('行高非法时退化为全量渲染而不是空白', () => {
    expect(windowRange({ count: 7, rowHeight: 0, scrollTop: 0, viewportHeight: 300, overscan: 5 })).toEqual({
      start: 0,
      end: 7,
      offset: 0,
      totalHeight: 0
    })
    expect(windowRange({ count: 7, rowHeight: Number.NaN, scrollTop: 50, viewportHeight: 300, overscan: 5 }).end).toBe(7)
  })

  test('缓冲大于总行数时两端夹住', () => {
    const range = windowRange({ count: 3, rowHeight: ROW, scrollTop: 0, viewportHeight: 1000, overscan: 50 })
    expect(range.start).toBe(0)
    expect(range.end).toBe(3)
  })
})

describe('revealScrollTop', () => {
  const viewport = 220

  test('已完整可见时不动（nearest）', () => {
    const scrollTop = 100 * ROW
    expect(revealScrollTop({ index: 101, rowHeight: ROW, viewportHeight: viewport, scrollTop, align: 'nearest' })).toBe(
      scrollTop
    )
  })

  test('在视野上方时对齐行首', () => {
    expect(revealScrollTop({ index: 20, rowHeight: ROW, viewportHeight: viewport, scrollTop: 100 * ROW, align: 'nearest' })).toBe(
      20 * ROW
    )
  })

  test('在视野下方时对齐行尾', () => {
    const target = revealScrollTop({
      index: 200,
      rowHeight: ROW,
      viewportHeight: viewport,
      scrollTop: 100 * ROW,
      align: 'nearest'
    })
    expect(target).toBe(200 * ROW + ROW - viewport)
    const bottom = (200 + 1) * ROW
    expect(target + viewport).toBeGreaterThanOrEqual(bottom)
  })

  test('居中定位', () => {
    const target = revealScrollTop({ index: 100, rowHeight: ROW, viewportHeight: viewport, scrollTop: 0, align: 'center' })
    expect(target).toBe(100 * ROW - (viewport - ROW) / 2)
  })

  test('第一行居中不会滚成负值', () => {
    expect(revealScrollTop({ index: 0, rowHeight: ROW, viewportHeight: viewport, scrollTop: 0, align: 'center' })).toBe(0)
  })

  test('非法输入返回有限值而不是 NaN', () => {
    const scrollTop = 10 * ROW
    expect(revealScrollTop({ index: 5, rowHeight: 0, viewportHeight: viewport, scrollTop, align: 'nearest' })).toBe(
      scrollTop
    )
    expect(revealScrollTop({ index: -1, rowHeight: ROW, viewportHeight: viewport, scrollTop, align: 'center' })).toBe(
      scrollTop
    )
    // NaN 被当作 0：可视高度为 0 时把该行对齐到视口底部
    const nan = revealScrollTop({
      index: 5,
      rowHeight: ROW,
      viewportHeight: Number.NaN,
      scrollTop: Number.NaN,
      align: 'nearest'
    })
    expect(Number.isFinite(nan)).toBe(true)
    expect(nan).toBe(5 * ROW + ROW)
  })

  test('可视高度为 0 时仍然给出可用的位置', () => {
    const target = revealScrollTop({ index: 3, rowHeight: ROW, viewportHeight: 0, scrollTop: 0, align: 'nearest' })
    expect(target).toBe(3 * ROW + ROW)
  })
})
