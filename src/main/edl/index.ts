import { writeFile } from 'node:fs/promises'
import type { DayRollup, Scene } from '../../shared/types'
import { describeWriteError } from '../errors'

/** CMX3600 固定 24fps（规格 R42.1）。 */
const FPS = 24
/** 记录时间轨从 01:00:00:00 起（规格 R42.3）。 */
const RECORD_START_MS = 3_600_000
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const EMPTY_TITLE = '未命名窗口'

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

/** 本地时刻 → 当天毫秒数。 */
function msOfDay(ms: number): number {
  const date = new Date(ms)
  return ((date.getHours() * 60 + date.getMinutes()) * 60 + date.getSeconds()) * 1000 + date.getMilliseconds()
}

/**
 * 毫秒 → HH:MM:SS:FF，帧向上取整（规格 R42.3）。
 * 整数毫秒乘 24 是精确整数，除以 1000 只在整除时精确，ceil 因此不会误进位。
 */
export function timecode(ms: number): string {
  const frames = Math.ceil((ms * FPS) / 1000)
  const ff = frames % FPS
  const totalSeconds = (frames - ff) / FPS
  const ss = totalSeconds % 60
  const mm = Math.floor(totalSeconds / 60) % 60
  const hh = Math.floor(totalSeconds / 3600) % 24
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`
}

/** 导出 EDL 的日期入参：合法返回日期字符串，非法返回 null（调用方回空路径）。 */
export function parseEdlDate(value: unknown): string | null {
  return typeof value === 'string' && DATE_PATTERN.test(value) ? value : null
}

/** 事件行按 CMX3600 的列宽排布：`001  AX       V     C        <srcIn> <srcOut> <recIn> <recOut>`。 */
function eventLine(index: number, scene: Scene, firstStart: number): string {
  const recIn = RECORD_START_MS + (scene.start - firstStart)
  const recOut = recIn + (scene.end - scene.start)
  const columns = `${pad(index, 3)}  ${'AX'.padEnd(9)}${'V'.padEnd(6)}${'C'.padEnd(9)}`
  return `${columns}${timecode(msOfDay(scene.start))} ${timecode(msOfDay(scene.end))} ${timecode(recIn)} ${timecode(recOut)}`
}

function clipName(scene: Scene): string {
  const title = scene.title.trim().length > 0 ? scene.title : EMPTY_TITLE
  // 分隔符用 ASCII 的 " - "：全角破折号在旧剪辑软件里容易变乱码。
  // 换行会把记录拆成两行，直接压成空格。
  return `${scene.exe} - ${title}`.replace(/[\r\n]+/g, ' ')
}

/**
 * 写 EDL。失败抛可读错误（`EDL 保存失败：没有写入权限（EACCES）`），
 * 由 IPC 层把 rejection 交给界面提示——目标目录不可写时不会静默失败。
 */
export async function writeEdlFile(target: string, day: DayRollup): Promise<void> {
  try {
    await writeFile(target, renderEdl(day), 'utf8')
  } catch (error) {
    throw new Error(`EDL 保存失败：${describeWriteError(error)}`)
  }
}

/**
 * 一天的 CMX3600 EDL（规格 R42 / v2.4）。只导出非空闲且未被标成花絮的镜头，
 * 记录轨按真实间隔连续排布，源时间码用镜头当天的本地墙上时间；标题为空时写"未命名窗口"。
 * 当天有花絮时在头部加一行注释说明漏了多少个。
 */
export function renderEdl(day: DayRollup): string {
  const shots = day.scenes.filter((scene) => scene.kind === 'shot' && scene.mark !== 'extra')
  const omitted = day.scenes.filter((scene) => scene.kind === 'shot' && scene.mark === 'extra').length
  const lines = [`TITLE: Dayfilm ${day.date}`, 'FCM: NON-DROP FRAME']
  if (omitted > 0) lines.push(`* NOTE: ${omitted} extra scenes omitted`)
  lines.push('')
  if (shots.length > 0) {
    const firstStart = shots[0].start
    shots.forEach((scene, index) => {
      lines.push(eventLine(index + 1, scene, firstStart))
      lines.push(`* FROM CLIP NAME: ${clipName(scene)}`)
    })
  }
  return `${lines.join('\n')}\n`
}
