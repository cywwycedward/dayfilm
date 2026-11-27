/**
 * 剪辑发现：从镜头序列里找出"跨时间的关系"（重返、易位、反复打开、深夜），
 * 每条都带证据镜头。纯函数，只用 DayRollup，不调用模型。
 */
import { matchProject } from '../../../shared/projects'
import type { ProjectRule } from '../../../shared/settings'
import { extractEntities, normalizeTitle } from '../../../shared/stories'
import type { DayRollup, Scene } from '../../../shared/types'

export type DiscoveryKind = 'return' | 'switch' | 'revisit' | 'late'

export interface Discovery {
  kind: DiscoveryKind
  text: string
  /** 证据镜头开始时刻，最早在前，最多 3 个 */
  evidence: number[]
}

/** 重返需要的最小间隔与中间镜头数（规格 S2.2）。 */
const RETURN_GAP_MS = 90 * 60_000
const RETURN_BETWEEN = 2
/** 主线易位：上午/下午各自至少这么长。 */
const SWITCH_MIN_MS = 20 * 60_000
const NOON_HOUR = 12
/** 反复打开：次数与总时长门槛。 */
const REVISIT_MIN_COUNT = 4
const REVISIT_MIN_MS = 15 * 60_000
/** 深夜：起点不早于 20:00，且至少 30 分钟。 */
const LATE_HOUR = 20
const LATE_MIN_MS = 30 * 60_000
export const DISCOVERY_LIMIT = 3

function hourOf(ms: number): number {
  return new Date(ms).getHours()
}

function clock(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function minutesOf(ms: number): number {
  return Math.max(1, Math.round(ms / 60_000))
}

/** 正片镜头：花絮不参与发现，否则"主线"会被短切 noise 抢走。 */
function featureShots(day: DayRollup): Scene[] {
  return day.scenes.filter((scene) => scene.kind === 'shot' && scene.mark !== 'extra')
}

/** 重返主线：同一实体隔了 ≥90 分钟又出现，中间至少隔 2 个镜头。 */
function findReturn(shots: Scene[]): Discovery | null {
  const appearances = new Map<string, number[]>()
  shots.forEach((scene, index) => {
    for (const entity of extractEntities(scene.title, scene.exe)) {
      const list = appearances.get(entity)
      if (list) list.push(index)
      else appearances.set(entity, [index])
    }
  })

  let best: { entity: string; first: Scene; again: Scene; count: number; spanMs: number } | null = null
  for (const [entity, indexes] of appearances) {
    if (indexes.length < 2) continue
    for (let i = 1; i < indexes.length; i += 1) {
      const before = shots[indexes[i - 1]]
      const after = shots[indexes[i]]
      const between = indexes[i] - indexes[i - 1] - 1
      if (after.start - before.end < RETURN_GAP_MS) continue
      if (between < RETURN_BETWEEN) continue
      const spanMs = after.start - before.end
      const better =
        best === null ||
        indexes.length > best.count ||
        (indexes.length === best.count && spanMs > best.spanMs)
      if (better) best = { entity, first: before, again: after, count: indexes.length, spanMs }
      break
    }
  }
  if (best === null) return null
  return {
    kind: 'return',
    text: `${clock(best.first.start)} 的 ${best.entity} 在 ${clock(best.again.start)} 又出现了，中间隔了 ${minutesOf(best.spanMs)} 分钟`,
    evidence: [best.first.start, best.again.start]
  }
}

/** 主线易位：上午与 12:00 之后的首要对象不同，且各自 ≥20 分钟。 */
function findSwitch(shots: Scene[], rules: readonly ProjectRule[]): Discovery | null {
  const label = (scene: Scene): string => matchProject(scene, rules) ?? scene.exe
  const totals = (subset: Scene[]): { name: string; ms: number } | null => {
    const map = new Map<string, number>()
    for (const scene of subset) map.set(label(scene), (map.get(label(scene)) ?? 0) + (scene.end - scene.start))
    let top: { name: string; ms: number } | null = null
    for (const [name, ms] of map) {
      if (top === null || ms > top.ms || (ms === top.ms && name < top.name)) top = { name, ms }
    }
    return top
  }
  const morning = totals(shots.filter((scene) => hourOf(scene.start) < NOON_HOUR))
  const afternoon = totals(shots.filter((scene) => hourOf(scene.start) >= NOON_HOUR))
  if (!morning || !afternoon) return null
  if (morning.ms < SWITCH_MIN_MS || afternoon.ms < SWITCH_MIN_MS) return null
  if (morning.name === afternoon.name) return null
  const firstAfternoon = shots.find((scene) => hourOf(scene.start) >= NOON_HOUR)
  return {
    kind: 'switch',
    text: `上午的主线是 ${morning.name}，${NOON_HOUR}:00 之后换成 ${afternoon.name}`,
    evidence: firstAfternoon ? [firstAfternoon.start] : []
  }
}

/** 反复打开：同一归一化标题出现 ≥4 次、累计 ≥15 分钟。 */
function findRevisit(shots: Scene[]): Discovery | null {
  const map = new Map<string, { count: number; ms: number; first: number; many: number[] }>()
  for (const scene of shots) {
    const key = normalizeTitle(scene.title).toLowerCase()
    if (key.length === 0) continue
    const current = map.get(key)
    const ms = scene.end - scene.start
    if (current) {
      current.count += 1
      current.ms += ms
      if (current.many.length < 3) current.many.push(scene.start)
      continue
    }
    map.set(key, { count: 1, ms, first: scene.start, many: [scene.start] })
  }
  let best: { count: number; ms: number; many: number[] } | null = null
  for (const value of map.values()) {
    if (value.count < REVISIT_MIN_COUNT || value.ms < REVISIT_MIN_MS) continue
    if (best === null || value.count > best.count || (value.count === best.count && value.ms > best.ms)) best = value
  }
  if (best === null) return null
  return {
    kind: 'revisit',
    text: `同一个窗口今天打开了 ${best.count} 次，共 ${minutesOf(best.ms)} 分钟`,
    evidence: best.many.slice(0, 3)
  }
}

/** 深夜镜头：20:00 之后开始、且 ≥30 分钟的一段。 */
function findLate(shots: Scene[]): Discovery | null {
  let best: Scene | null = null
  for (const scene of shots) {
    if (hourOf(scene.start) < LATE_HOUR) continue
    if (scene.end - scene.start < LATE_MIN_MS) continue
    if (best === null || scene.end - scene.start > best.end - best.start) best = scene
  }
  if (best === null) return null
  return {
    kind: 'late',
    text: `${LATE_HOUR}:00 之后还有一段 ${minutesOf(best.end - best.start)} 分钟的镜头`,
    evidence: [best.start]
  }
}

/**
 * 一天最多三条，按"重返 → 易位 → 反复 → 深夜"的优先级取。
 * 没有任何发现时返回空数组，界面整块隐藏。
 */
export function findDiscoveries(
  day: DayRollup,
  rules: readonly ProjectRule[] = [],
  limit = DISCOVERY_LIMIT
): Discovery[] {
  const shots = featureShots(day)
  if (shots.length < 2) return []
  const found: Discovery[] = []
  const push = (value: Discovery | null): void => {
    if (value === null) return
    if (found.length >= limit) return
    found.push(value)
  }
  push(findReturn(shots))
  push(findSwitch(shots, rules))
  push(findRevisit(shots))
  push(findLate(shots))
  return found
}
