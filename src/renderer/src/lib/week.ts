/** 周视图：把一天的镜头按 24 小时分桶，亮度随时长对数增长。纯函数。 */
import type { DayRollup } from '../../../shared/types'
import { isoDate, startOfDay } from './time'

export interface WeekCell {
  date: string
  /** 24 个桶的亮度 0–1 */
  buckets: number[]
  hasData: boolean
  isToday: boolean
}

/** 亮度的参考时长：半小时就打满 */
const REFERENCE_MINUTES = 30
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

export function dayBuckets(day: DayRollup | null, count = 24): number[] {
  const buckets = new Array<number>(count).fill(0)
  if (!day) return buckets
  const buckets24 = new Array<number>(24).fill(0)
  for (const scene of day.scenes) {
    if (scene.kind !== 'shot') continue
    const from = Math.min(scene.start, scene.end)
    const to = Math.max(scene.start, scene.end)
    let cursor = from
    while (cursor < to) {
      const hourStart = new Date(cursor)
      hourStart.setMinutes(0, 0, 0)
      const hourEnd = hourStart.getTime() + HOUR_MS
      if (!(hourEnd > cursor)) break
      const slice = Math.min(to, hourEnd) - cursor
      buckets24[hourStart.getHours()] += slice
      cursor = hourEnd
    }
  }
  const reference = Math.log1p(REFERENCE_MINUTES)
  for (let hour = 0; hour < 24; hour += 1) {
    const ms = buckets24[hour]
    if (ms <= 0) continue
    const index = Math.min(count - 1, Math.floor((hour * count) / 24))
    buckets[index] = Math.max(buckets[index], Math.min(1, Math.log1p(ms / 60_000) / reference))
  }
  return buckets
}

export function buildWeek(
  dates: readonly string[],
  days: ReadonlyArray<DayRollup | null>,
  today: string
): WeekCell[] {
  return dates.map((date, index) => {
    const day = days[index] ?? null
    return {
      date,
      buckets: dayBuckets(day),
      hasData: day !== null && day.scenes.some((scene) => scene.kind === 'shot'),
      isToday: date === today
    }
  })
}

/** 最近 7 天（含今天），从旧到新排列。 */
export function lastSevenDates(today: string): string[] {
  const base = startOfDay(today)
  const out: string[] = []
  for (let back = 6; back >= 0; back -= 1) out.push(isoDate(base - back * DAY_MS))
  return out
}
