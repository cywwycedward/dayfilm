/** HUD 窗口位置计算（纯函数，显示器信息由调用方注入，便于单测）。 */

export interface HudRect {
  x: number
  y: number
  width: number
  height: number
}

export interface HudSize {
  width: number
  height: number
}

export interface HudPoint {
  x: number
  y: number
}

/** 默认位置距工作区边缘 24px（规格 R40.1）。 */
export const HUD_MARGIN = 24

/** 默认位置：某个工作区的右上角。 */
export function defaultHudPosition(workArea: HudRect, size: HudSize, margin = HUD_MARGIN): HudPoint {
  return {
    x: Math.round(workArea.x + workArea.width - size.width - margin),
    y: Math.round(workArea.y + margin)
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 矩形是否完整落在工作区里（副屏可以是负坐标）。 */
export function isInsideWorkArea(position: HudPoint, size: HudSize, area: HudRect): boolean {
  return (
    position.x >= area.x &&
    position.y >= area.y &&
    position.x + size.width <= area.x + area.width &&
    position.y + size.height <= area.y + area.height
  )
}

function overlapArea(position: HudPoint, size: HudSize, area: HudRect): number {
  const width = Math.max(0, Math.min(position.x + size.width, area.x + area.width) - Math.max(position.x, area.x))
  const height = Math.max(0, Math.min(position.y + size.height, area.y + area.height) - Math.max(position.y, area.y))
  return width * height
}

/** 两个矩形之间的间隙距离（重叠时为 0），用来找"最近"的显示器。 */
function gapDistance(position: HudPoint, size: HudSize, area: HudRect): number {
  const dx = Math.max(0, Math.max(area.x - (position.x + size.width), position.x - (area.x + area.width)))
  const dy = Math.max(0, Math.max(area.y - (position.y + size.height), position.y - (area.y + area.height)))
  return Math.hypot(dx, dy)
}

/**
 * 选最近的显示器工作区：先看有没有能完整容纳的，其次看重叠面积最大的，
 * 最后按间隙距离取最近的。并列时保留列表里的第一个（结果稳定）。
 */
export function nearestWorkArea(position: HudPoint, size: HudSize, workAreas: readonly HudRect[]): HudRect | null {
  if (workAreas.length === 0) return null

  let best: HudRect | null = null
  let bestOverlap = 0
  for (const area of workAreas) {
    if (isInsideWorkArea(position, size, area)) return area
    const overlap = overlapArea(position, size, area)
    if (overlap > bestOverlap) {
      best = area
      bestOverlap = overlap
    }
  }
  if (best && bestOverlap > 0) return best

  let nearest = workAreas[0]
  let nearestGap = gapDistance(position, size, nearest)
  for (const area of workAreas.slice(1)) {
    const gap = gapDistance(position, size, area)
    if (gap < nearestGap) {
      nearest = area
      nearestGap = gap
    }
  }
  return nearest
}

/** 把位置夹进最近的工作区；工作区比窗口还小时贴左上角。 */
export function clampToWorkAreas(position: HudPoint, size: HudSize, workAreas: readonly HudRect[]): HudPoint {
  const area = nearestWorkArea(position, size, workAreas)
  if (!area) return position
  if (isInsideWorkArea(position, size, area)) return position
  return {
    x: clamp(position.x, area.x, Math.max(area.x, area.x + area.width - size.width)),
    y: clamp(position.y, area.y, Math.max(area.y, area.y + area.height - size.height))
  }
}

/**
 * 最终位置：
 * - 没拖过（x/y 为 null）→ 回退工作区（调用方传"光标所在显示器"）的右上角；
 * - 拖过但落在任何工作区之外（含负坐标副屏、改了分辨率、拔了显示器）→ 夹进最近的工作区，
 *   而不是把位置丢掉。
 */
export function resolveHudPosition(
  saved: { x: number | null; y: number | null },
  size: HudSize,
  workAreas: readonly HudRect[],
  fallbackWorkArea: HudRect,
  margin = HUD_MARGIN
): HudPoint {
  if (saved.x === null || saved.y === null) return defaultHudPosition(fallbackWorkArea, size, margin)
  return clampToWorkAreas({ x: saved.x, y: saved.y }, size, workAreas)
}
