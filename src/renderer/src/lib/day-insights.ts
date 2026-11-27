/**
 * S5/S6：最长镜头之后的 15 分钟，与当天最长一段中场休息的形状。
 * 纯函数，只吃传入的 DayRollup，不读当前时间、不用随机。
 */
import { normalizeTitle } from '../../../shared/stories'
import type { DayRollup, Scene } from '../../../shared/types'

export interface AfterShotGroup {
  name: string
  count: number
}

export interface AfterShot {
  endAt: number
  groups: AfterShotGroup[]
}

export interface IntermissionShape {
  start: number
  ms: number
  outcome: 'returned' | 'changed' | 'unknown'
  nextExe: string | null
}

export const AFTER_SHOT_WINDOW_MS = 15 * 60_000
export const AFTER_SHOT_LIMIT = 3

/** 组名：归一化标题；标题归一化后为空时退回进程名，避免出现无名的一组。 */
function groupName(scene: Scene): string {
  const title = normalizeTitle(scene.title)
  return title.length > 0 ? title : scene.exe
}

/** 锚点之后 15 分钟内开始的镜头，按归一化标题分组，次数降序 → 首次出现升序。 */
export function afterLongestShot(day: DayRollup): AfterShot | null {
  const anchor = day.longestShot
  if (anchor === null) return null
  const endAt = anchor.end
  const until = endAt + AFTER_SHOT_WINDOW_MS

  const shots = day.scenes
    .filter((scene) => scene.kind === 'shot' && scene.start >= endAt && scene.start < until)
    .sort((a, b) => a.start - b.start)
  if (shots.length === 0) return null

  const groups: (AfterShotGroup & { first: number })[] = []
  const byKey = new Map<string, AfterShotGroup & { first: number }>()
  for (const scene of shots) {
    const name = groupName(scene)
    const key = name.toLowerCase()
    const current = byKey.get(key)
    if (current) {
      current.count += 1
      continue
    }
    const group = { name, count: 1, first: scene.start }
    byKey.set(key, group)
    groups.push(group)
  }

  groups.sort((a, b) => b.count - a.count || a.first - b.first)
  return { endAt, groups: groups.slice(0, AFTER_SHOT_LIMIT).map(({ name, count }) => ({ name, count })) }
}

/** 当天最长的一般中场休息（等长取更早），比较前后两条有效镜头的窗口身份。 */
export function longestIntermission(day: DayRollup): IntermissionShape | null {
  let rest: Scene | null = null
  for (const scene of day.scenes) {
    if (scene.kind !== 'intermission') continue
    // 严格大于：等长时保留先遇到（更早）的那一段
    if (rest === null || scene.end - scene.start > rest.end - rest.start) rest = scene
  }
  if (rest === null) return null

  let before: Scene | null = null
  let after: Scene | null = null
  for (const scene of day.scenes) {
    if (scene.kind !== 'shot') continue
    if (scene.start < rest.start && (before === null || scene.start > before.start)) before = scene
    if (scene.end > rest.end && (after === null || scene.end < after.end)) after = scene
  }

  const base = { start: rest.start, ms: rest.end - rest.start }
  if (after === null) return { ...base, outcome: 'unknown', nextExe: null }
  // exe 相同但标题不同也算换了窗口：只有两者都相同才是同一个窗口
  if (before !== null && before.exe === after.exe && before.title === after.title) {
    return { ...base, outcome: 'returned', nextExe: null }
  }
  return { ...base, outcome: 'changed', nextExe: after.exe }
}
