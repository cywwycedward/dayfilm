/**
 * 放映字幕：每个镜头一句话，按规格的优先级取第一条可用的依据。
 * 纯函数，不调用模型，同一份数据永远得到同一句。
 */
import type { DayRollup, Scene } from '../../../shared/types'
import { pickHighlights } from './highlights'

export interface Narration {
  /** 第几镜（1 开始） */
  index: number
  text: string
}

const DENSE_LIMIT = 10

function minutesOf(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60))
}

function shotsOf(day: DayRollup): Scene[] {
  return day.scenes.filter((scene) => scene.kind === 'shot')
}

/**
 * 优先级：最长镜头 > 密集窗口里的前 10 镜 > 第一镜 > 最后一镜 > 普通停留。
 * 中场休息与没有镜头的日子返回 null（放映里不挂字幕）。
 */
export function pickNarration(day: DayRollup, scene: Scene, index: number): Narration | null {
  if (scene.kind !== 'shot') return null
  const shots = shotsOf(day)
  if (shots.length === 0) return null
  const ordinal = index > 0 ? index : shots.findIndex((shot) => shot.id === scene.id) + 1
  if (ordinal <= 0) return null

  const highlights = pickHighlights(day)
  const longest = highlights.longest
  if (longest && longest.id === scene.id) {
    return { index: ordinal, text: `这一天最长的一条，你在这里待了 ${minutesOf(scene.seconds)} 分钟。` }
  }

  const busiest = highlights.busiest
  if (busiest && busiest.cuts >= 2) {
    const inWindow = scene.start >= busiest.start && scene.start < busiest.end
    const rank = shots.filter((shot) => shot.start >= busiest.start && shot.start < scene.start).length
    if (inWindow && rank < DENSE_LIMIT) {
      const windowMinutes = Math.max(1, Math.round((busiest.end - busiest.start) / 60_000))
      return { index: ordinal, text: `${windowMinutes} 分钟里切出去 ${busiest.cuts} 次。` }
    }
  }

  if (shots[0].id === scene.id) return { index: ordinal, text: '这一天从这里开始。' }
  if (shots[shots.length - 1].id === scene.id) return { index: ordinal, text: '这一天的最后一次停在这里。' }
  return { index: ordinal, text: `停留 ${minutesOf(scene.seconds)} 分钟。` }
}
