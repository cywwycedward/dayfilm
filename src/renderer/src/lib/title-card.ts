/**
 * 片头卡：切到有镜头的一天时，日期 → 题材 → DAYFILM 依次出现，1.4 秒后淡出。
 * 纯函数只回答两件事：这次要不要播、某一刻各元素的不透明度。
 */

export const TITLE_CARD_MS = 1400

export type TitleCardElement = 'date' | 'verdict' | 'mark'

export interface TitleCardFrame {
  id: TitleCardElement
  /** 进度区间（0–1）：淡入起点/终点 */
  in: readonly [number, number]
  /** 淡出区间（0–1） */
  out: readonly [number, number]
}

/** 三个元素依次亮起，最后一起淡出。 */
export const TITLE_CARD_FRAMES: readonly TitleCardFrame[] = [
  { id: 'date', in: [0.06, 0.2], out: [0.88, 1] },
  { id: 'verdict', in: [0.22, 0.36], out: [0.88, 1] },
  { id: 'mark', in: [0.38, 0.52], out: [0.88, 1] }
]

/** 同一次运行里同一天只播一次；减弱动效时不播。 */
export function shouldPlayTitleCard(
  seenDates: ReadonlySet<string>,
  date: string,
  reducedMotion: boolean
): boolean {
  if (reducedMotion) return false
  return !seenDates.has(date)
}

export function titleCardProgress(elapsedMs: number): number {
  const total = Number.isFinite(elapsedMs) ? elapsedMs : 0
  return Math.min(1, Math.max(0, total / TITLE_CARD_MS))
}

function fade(value: number, from: number, to: number): number {
  if (!(to > from)) return value >= to ? 1 : 0
  return Math.min(1, Math.max(0, (value - from) / (to - from)))
}

/** 某元素在进度 p 处的不透明度：先淡入到 1，再在 out 区间淡出。 */
export function titleCardOpacity(frame: TitleCardFrame, progress: number): number {
  const p = Math.min(1, Math.max(0, progress))
  const appear = fade(p, frame.in[0], frame.in[1])
  const leave = 1 - fade(p, frame.out[0], frame.out[1])
  return Math.min(appear, leave)
}
