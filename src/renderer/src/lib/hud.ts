/**
 * 导演 HUD 的纯参数：360×148 小窗里显示什么、节奏柱多高、什么状态。
 * 不碰 DOM；hud.ts 只负责把这里的结果贴到元素上。
 */
import type { LiveState, Scene } from '../../../shared/types'

export const HUD_WIDTH = 360
export const HUD_HEIGHT = 148
/** 节奏柱覆盖最近 30 分钟 */
export const HUD_MINUTES = 30
export const HUD_BAR_WIDTH = 2
/** 单根柱最高 24px，空分钟给 1px 底线 */
export const HUD_BAR_MAX = 24
export const HUD_BAR_MIN = 1
/** 节奏柱可用宽度：360 − 左右内边距 16×2 */
export const HUD_RHYTHM_WIDTH = HUD_WIDTH - 32

export type HudMood = 'shooting' | 'idle' | 'paused' | 'error'

const STATUS: Record<HudMood, string> = {
  shooting: 'REC',
  idle: '空闲',
  paused: '已暂停',
  error: '错误'
}

export interface HudBar {
  x: number
  w: number
  /** 该分钟的剪辑次数 */
  count: number
  /** 像素高度，绘制时从底部对齐 */
  height: number
}

export interface HudToday {
  shots: number
  cuts: number
  verdict: string
}

export interface HudView {
  mood: HudMood
  status: string
  exe: string
  title: string
  elapsedMs: number
  /** 空闲时是“离开”前缀，其余为空 */
  elapsedPrefix: string
  elapsedText: string
  /** 秒表是否在走；空闲/暂停/出错时冻结 */
  ticking: boolean
  today: HudToday
  rhythm: HudBar[]
}

/** 出错 > 暂停 > 空闲 > 拍摄。空闲以 scene 为空为准（主进程只在有采样时给 scene）。 */
export function hudMood(live: LiveState): HudMood {
  if (live.captureError !== null) return 'error'
  if (live.paused) return 'paused'
  if (live.scene === null) return 'idle'
  return 'shooting'
}

function shotsOf(live: LiveState): Scene[] {
  return live.day.scenes.filter((scene) => scene.kind === 'shot')
}

function lastShot(live: LiveState): Scene | null {
  const shots = shotsOf(live)
  return shots.length > 0 ? shots[shots.length - 1] : null
}

/** 最近 N 分钟每分钟的剪辑次数：最早一分钟在前，最近一分钟在最后。 */
export function rhythmBuckets(
  scenes: readonly Scene[],
  nowMs: number,
  minutes = HUD_MINUTES
): number[] {
  const count = Math.max(1, Math.floor(minutes))
  const buckets = new Array<number>(count).fill(0)
  const minute = 60_000
  for (const scene of scenes) {
    if (scene.kind !== 'shot') continue
    const age = nowMs - scene.start
    if (!Number.isFinite(age) || age < 0 || age >= count * minute) continue
    const index = count - 1 - Math.floor(age / minute)
    if (index >= 0 && index < count) buckets[index] += 1
  }
  return buckets
}

/** 30 根柱的横向位置：铺满可用宽度，柱宽固定 2px，间距均分。 */
export function rhythmBars(counts: readonly number[], width = HUD_RHYTHM_WIDTH): HudBar[] {
  const count = Math.max(1, counts.length)
  const gap = count > 1 ? (width - count * HUD_BAR_WIDTH) / (count - 1) : 0
  const peak = Math.max(1, ...counts)
  return counts.map((value, index) => ({
    x: index * (HUD_BAR_WIDTH + gap),
    w: HUD_BAR_WIDTH,
    count: value,
    height:
      value === 0 ? HUD_BAR_MIN : Math.max(HUD_BAR_MIN + 1, Math.round((value / peak) * HUD_BAR_MAX))
  }))
}

/** 本镜已持续毫秒：拍摄中按 now 算，否则冻结在当天最后一镜的时长。 */
export function hudElapsedMs(live: LiveState, nowMs: number): number {
  if (live.scene) return Math.max(0, nowMs - live.scene.start)
  const last = lastShot(live)
  return last ? Math.max(0, last.seconds * 1000) : 0
}

/** 离开键盘的时长：从当天最后一条记录的结束算起。 */
export function hudLeaveMs(live: LiveState, nowMs: number): number {
  const scenes = live.day.scenes
  const last = scenes[scenes.length - 1]
  if (!last) return 0
  return Math.max(0, nowMs - last.end)
}

/** 秒级秒表：MM:SS，分钟不进位到小时。 */
export function fmtHudDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function hudView(live: LiveState, nowMs: number): HudView {
  const mood = hudMood(live)
  const shots = shotsOf(live)
  const last = lastShot(live)
  const idle = mood === 'idle'
  const elapsedMs = idle ? hudLeaveMs(live, nowMs) : hudElapsedMs(live, nowMs)
  const errorText = live.captureError ?? ''
  const title = idle ? '离开键盘' : mood === 'error' ? errorText : (live.scene?.title ?? last?.title ?? '—')
  return {
    mood,
    status: STATUS[mood],
    exe: live.scene?.exe ?? last?.exe ?? (idle ? '空闲' : '—'),
    title,
    elapsedMs,
    elapsedPrefix: idle ? '离开' : '',
    elapsedText: fmtHudDuration(elapsedMs),
    ticking: mood === 'shooting',
    today: {
      shots: shots.length,
      cuts: live.day.cuts,
      verdict: live.day.verdict.label
    },
    rhythm: rhythmBars(rhythmBuckets(live.day.scenes, nowMs))
  }
}
