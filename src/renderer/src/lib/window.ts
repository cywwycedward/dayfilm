/**
 * 虚拟列表的区间计算。列表只渲染可视区加缓冲的行，这里负责"看到第几行、偏移多少"。
 * 纯函数：不读 DOM、不看时间，边界全部由入参决定。
 */

export interface WindowInput {
  /** 总行数 */
  count: number
  /** 固定行高（含行间距），像素 */
  rowHeight: number
  /** 容器当前滚动位置 */
  scrollTop: number
  /** 容器可视高度 */
  viewportHeight: number
  /** 上下各保留的缓冲行数 */
  overscan: number
}

export interface RowRange {
  /** 首个渲染行（含） */
  start: number
  /** 末尾渲染行（不含） */
  end: number
  /** 渲染区相对内容顶部的偏移，像素 */
  offset: number
  /** 内容总高，像素 */
  totalHeight: number
}

function safeRowHeight(rowHeight: number): number {
  return Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : 0
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0
}

export function windowRange(input: WindowInput): RowRange {
  const count = Math.max(0, Math.floor(safeNumber(input.count)))
  const rowHeight = safeRowHeight(input.rowHeight)
  // 行高不可用时退化为全量渲染，宁可贵一点也不能丢行
  if (rowHeight === 0) return { start: 0, end: count, offset: 0, totalHeight: 0 }
  if (count === 0) return { start: 0, end: 0, offset: 0, totalHeight: 0 }

  const totalHeight = count * rowHeight
  const viewport = Math.max(0, safeNumber(input.viewportHeight))
  const maxScroll = Math.max(0, totalHeight - viewport)
  const scrollTop = Math.min(maxScroll, Math.max(0, safeNumber(input.scrollTop)))
  const overscan = Math.max(0, Math.floor(safeNumber(input.overscan)))

  const first = Math.floor(scrollTop / rowHeight)
  // 多算一行，覆盖底部被切掉的那一行
  const visible = Math.ceil(viewport / rowHeight) + 1
  const start = Math.max(0, first - overscan)
  const end = Math.min(count, first + visible + overscan)
  return { start, end, offset: start * rowHeight, totalHeight }
}

export interface RevealInput {
  index: number
  rowHeight: number
  viewportHeight: number
  scrollTop: number
  /** center：居中；nearest：已完整可见就不动 */
  align: 'center' | 'nearest'
}

/** 把指定行滚进视野需要的 scrollTop。调用方负责写入滚动容器。 */
export function revealScrollTop(input: RevealInput): number {
  const current = Math.max(0, safeNumber(input.scrollTop))
  const rowHeight = safeRowHeight(input.rowHeight)
  if (rowHeight === 0 || input.index < 0 || !Number.isFinite(input.index)) return current

  const viewport = Math.max(0, safeNumber(input.viewportHeight))
  const top = input.index * rowHeight
  const bottom = top + rowHeight
  if (input.align === 'center') {
    return Math.max(0, Math.round(top - (viewport - rowHeight) / 2))
  }
  if (top >= current && bottom <= current + viewport) return current
  return Math.max(0, Math.round(top < current ? top : bottom - viewport))
}
