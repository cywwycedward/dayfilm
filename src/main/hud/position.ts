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
/** 至少要有这么大一块落在工作区里才算"还在屏幕上"。 */
const MIN_VISIBLE = 40

/** 默认位置：工作区右上角。 */
export function defaultHudPosition(workArea: HudRect, size: HudSize, margin = HUD_MARGIN): HudPoint {
  return {
    x: Math.round(workArea.x + workArea.width - size.width - margin),
    y: Math.round(workArea.y + margin)
  }
}

function overlap(a: { start: number; end: number }, b: { start: number; end: number }): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
}

/** 位置是否还有足够一块落在某个显示器的工作区里（分辨率/显示器变化后可能跑到屏幕外）。 */
export function isHudPositionVisible(position: HudPoint, size: HudSize, workAreas: readonly HudRect[]): boolean {
  return workAreas.some((area) => {
    const dx = overlap({ start: position.x, end: position.x + size.width }, { start: area.x, end: area.x + area.width })
    const dy = overlap({ start: position.y, end: position.y + size.height }, { start: area.y, end: area.y + area.height })
    return dx >= MIN_VISIBLE && dy >= MIN_VISIBLE
  })
}

/**
 * 最终位置：保存过且仍在任何一个工作区里就沿用，否则回到主显示器的默认位置。
 * `saved.x`/`saved.y` 任一为 null 表示还没拖过。
 */
export function resolveHudPosition(
  saved: { x: number | null; y: number | null },
  size: HudSize,
  workAreas: readonly HudRect[],
  primaryWorkArea: HudRect,
  margin = HUD_MARGIN
): HudPoint {
  if (saved.x !== null && saved.y !== null) {
    const position = { x: saved.x, y: saved.y }
    if (isHudPositionVisible(position, size, workAreas)) return position
  }
  return defaultHudPosition(primaryWorkArea, size, margin)
}
