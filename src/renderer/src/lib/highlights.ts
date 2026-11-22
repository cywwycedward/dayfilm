/** 高光：最长镜头、剪辑最密的 30 分钟、时长第一的进程。纯函数。 */
import type { DayRollup, Scene } from '../../../shared/types'

export const HIGHLIGHT_WINDOW_MS = 30 * 60_000

export interface BusiestWindow {
  start: number
  end: number
  /** 窗口内的剪辑次数（镜头数 - 1） */
  cuts: number
  /** 窗口内的镜头数 */
  shots: number
}

export interface Highlights {
  longest: Scene | null
  busiest: BusiestWindow | null
  topApp: { exe: string; ms: number } | null
}

const EMPTY: Highlights = { longest: null, busiest: null, topApp: null }

export function pickHighlights(day: DayRollup, windowMs = HIGHLIGHT_WINDOW_MS): Highlights {
  const shots = day.scenes.filter((scene) => scene.kind === 'shot')
  if (shots.length === 0) return EMPTY
  const span = windowMs > 0 && Number.isFinite(windowMs) ? windowMs : HIGHLIGHT_WINDOW_MS

  let longest = shots[0]
  for (const shot of shots) {
    if (shot.seconds > longest.seconds) longest = shot
  }

  // 以每个镜头的起点作为窗口左端，取窗口内镜头数最多的一段（并列取最早）
  let busiest: BusiestWindow | null = null
  for (const anchor of shots) {
    const end = anchor.start + span
    let count = 0
    for (const shot of shots) {
      if (shot.start >= anchor.start && shot.start < end) count += 1
    }
    if (busiest === null || count > busiest.shots) {
      busiest = { start: anchor.start, end, cuts: Math.max(0, count - 1), shots: count }
    }
  }

  const totals = new Map<string, number>()
  for (const shot of shots) {
    totals.set(shot.exe, (totals.get(shot.exe) ?? 0) + (shot.end - shot.start))
  }
  let topApp: { exe: string; ms: number } | null = null
  for (const [exe, ms] of totals) {
    if (topApp === null || ms > topApp.ms) topApp = { exe, ms }
  }

  return { longest, busiest, topApp }
}
