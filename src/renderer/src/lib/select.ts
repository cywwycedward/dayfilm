/** 自绘下拉框的纯逻辑：高亮移动、初始高亮、弹层朝向。不碰 DOM。 */

export const SELECT_PANEL_MARGIN = 8

/** 打开时的高亮行：选中项优先，越界夹到两端；空列表返回 -1。 */
export function initialHighlight(selectedIndex: number, count: number): number {
  if (count <= 0) return -1
  return Math.min(count - 1, Math.max(0, selectedIndex))
}

/** 键盘移动高亮：↑↓ 循环，Home/End 到两端；不认识的键不动。 */
export function moveHighlight(current: number, key: string, count: number): number {
  if (count <= 0) return -1
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : (current + 1) % count
    case 'ArrowUp':
      return current < 0 ? count - 1 : (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return current
  }
}

/** 面板朝下还是朝上：放不下就翻；两边都放不下时选空间大的一边。 */
export function panelPlacement(
  trigger: { top: number; bottom: number },
  panelHeight: number,
  viewportHeight: number,
  margin = SELECT_PANEL_MARGIN
): 'down' | 'up' {
  const below = viewportHeight - trigger.bottom - margin
  const above = trigger.top - margin
  if (panelHeight <= below) return 'down'
  if (panelHeight <= above) return 'up'
  return below >= above ? 'down' : 'up'
}
