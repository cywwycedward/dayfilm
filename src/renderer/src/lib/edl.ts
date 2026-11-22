/**
 * CMX3600 EDL（24fps）：供剪辑软件导入当日时间线。
 * 渲染层只在 mock 模式生成这份文本；真实导出的落盘在主进程。
 */
import type { DayRollup, Scene } from '../../../shared/types'

export const EDL_FPS = 24
/** 记录时间从 01:00:00:00 起 */
const RECORD_BASE_MS = 3_600_000

function pad(value: number, width = 2): string {
  return String(Math.trunc(value)).padStart(width, '0')
}

function framesOf(ms: number): number {
  return Math.min(EDL_FPS - 1, Math.max(0, Math.floor((ms % 1000) / (1000 / EDL_FPS))))
}

/** 素材时间码：按本机墙钟输出 HH:MM:SS:FF。 */
export function sourceTimecode(ts: number): string {
  const date = new Date(ts)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}:${pad(framesOf(date.getMilliseconds()))}`
}

/** 记录时间码：从 01:00:00:00 起的偏移。 */
export function recordTimecode(offsetMs: number): string {
  const ms = RECORD_BASE_MS + Math.max(0, offsetMs)
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const frames = framesOf(ms)
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`
}

function clipLine(shot: Scene, ordinal: number, first: number): string[] {
  const sourceIn = sourceTimecode(shot.start)
  const sourceOut = sourceTimecode(shot.end)
  const recordIn = recordTimecode(shot.start - first)
  const recordOut = recordTimecode(shot.end - first)
  const title = shot.title.length > 0 ? shot.title : '未命名窗口'
  return [
    `${pad(ordinal, 3)}  AX       V     C        ${sourceIn} ${sourceOut} ${recordIn} ${recordOut}`,
    `* FROM CLIP NAME: ${shot.exe} — ${title}`
  ]
}

/** 只导出非空闲镜头；记录时间保留真实间隔（同一时间轴上的差）。 */
export function formatEdl(day: DayRollup): string {
  const shots = day.scenes.filter((scene) => scene.kind === 'shot')
  const lines = [`TITLE: Dayfilm ${day.date}`, 'FCM: NON-DROP FRAME', '']
  if (shots.length > 0) {
    const first = shots[0].start
    shots.forEach((shot, index) => {
      lines.push(...clipLine(shot, index + 1, first))
    })
    lines.push('')
  }
  return lines.join('\n')
}
