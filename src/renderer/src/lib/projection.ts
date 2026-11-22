/**
 * 放映状态机：把"播放"从"播放头前进"换成"进入放映"。
 * 纯函数，不碰 DOM、不读时钟：时间由调用方按帧喂进来。
 */
import type { Scene } from '../../../shared/types'

export const PROJECTION_SPEEDS = [60, 600, 3600] as const
export type ProjectionSpeed = (typeof PROJECTION_SPEEDS)[number]

export interface ProjectionState {
  active: boolean
  /** 胶片时间指针（毫秒时间戳） */
  filmMs: number
  speed: ProjectionSpeed
  /** 当前是当天第几镜（1 开始；0 = 正处在空隙或中场休息） */
  shot: number
  /** 当天镜头总数 */
  total: number
  /** 进入放映后发生的剪辑次数 */
  cuts: number
  /** 真实经过的毫秒，用来算“每秒 N 次剪辑” */
  realMs: number
  sound: boolean
}

export const EMPTY_PROJECTION: ProjectionState = {
  active: false,
  filmMs: 0,
  speed: 600,
  shot: 0,
  total: 0,
  cuts: 0,
  realMs: 0,
  sound: false
}

/** 当天镜头序号表：只数 shot。 */
export function shotIndexMap(scenes: readonly Scene[]): Map<string, number> {
  const map = new Map<string, number>()
  let index = 0
  for (const scene of scenes) {
    if (scene.kind !== 'shot') continue
    index += 1
    map.set(scene.id, index)
  }
  return map
}

/** 某个时刻是当天第几镜；空隙与中场休息返回 0。 */
export function shotAt(filmMs: number, scenes: readonly Scene[]): number {
  const ordinals = shotIndexMap(scenes)
  for (const scene of scenes) {
    if (filmMs >= scene.start && filmMs < scene.end) {
      return scene.kind === 'shot' ? (ordinals.get(scene.id) ?? 0) : 0
    }
  }
  return 0
}

/** 胶片范围：第一个镜头的开始到当天最后一条记录的结束。 */
export function filmBounds(scenes: readonly Scene[]): { start: number; end: number } | null {
  if (scenes.length === 0) return null
  const start = scenes[0].start
  const end = scenes[scenes.length - 1].end
  if (!(end > start)) return null
  return { start, end }
}

/** 播放起点：选中的镜头优先；否则当天第一个镜头；没有素材返回 null。 */
export function playbackStart(selected: Scene | null, scenes: readonly Scene[]): number | null {
  if (selected) return selected.start
  const first = scenes.find((scene) => scene.kind === 'shot')
  return first ? first.start : null
}

/** 素材区间：首个镜头开始到最后一个镜头结束（尾部的中场休息不算）。 */
export function playbackRange(scenes: readonly Scene[]): { start: number; end: number } | null {
  let start: number | null = null
  let end: number | null = null
  for (const scene of scenes) {
    if (scene.kind !== 'shot') continue
    if (start === null) start = scene.start
    end = Math.max(end ?? scene.end, scene.end)
  }
  if (start === null || end === null) return null
  return { start, end }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/** 进入放映：把指针夹进胶片范围，算出镜次与总数。 */
export function enterProjection(
  filmMs: number,
  scenes: readonly Scene[],
  options: { speed?: ProjectionSpeed; sound?: boolean } = {}
): ProjectionState {
  const bounds = filmBounds(scenes)
  const ordinals = shotIndexMap(scenes)
  const withOrdinal = scenes.map((scene) => ({ ...scene, ordinal: ordinals.get(scene.id) ?? 0 }))
  const total = ordinals.size
  if (!bounds) {
    return { ...EMPTY_PROJECTION, active: true, speed: options.speed ?? 600, sound: options.sound ?? false, total }
  }
  const pointer = Number.isFinite(filmMs) ? clamp(filmMs, bounds.start, bounds.end) : bounds.start
  return {
    active: true,
    filmMs: pointer,
    speed: options.speed ?? 600,
    shot: shotIn(withOrdinal, pointer),
    total,
    cuts: 0,
    realMs: 0,
    sound: options.sound ?? false
  }
}

interface OrderedScene extends Scene {
  ordinal?: number
}

function shotIn(scenes: readonly OrderedScene[], filmMs: number): number {
  for (const scene of scenes) {
    if (filmMs >= scene.start && filmMs < scene.end) return scene.kind === 'shot' ? (scene.ordinal ?? 0) : 0
  }
  return 0
}

/** 推进一帧：deltaRealMs 是真实经过时间，胶片按倍速前进。 */
export function advanceProjection(
  state: ProjectionState,
  deltaRealMs: number,
  scenes: readonly Scene[]
): ProjectionState {
  if (!state.active) return state
  const bounds = filmBounds(scenes)
  const delta = Number.isFinite(deltaRealMs) ? Math.max(0, deltaRealMs) : 0
  if (!bounds) return { ...state, realMs: state.realMs + delta }
  const ordinals = shotIndexMap(scenes)
  const withOrdinal = scenes.map((scene) => ({ ...scene, ordinal: ordinals.get(scene.id) ?? 0 }))
  const filmMs = clamp(state.filmMs + delta * state.speed, bounds.start, bounds.end)
  const shot = shotIn(withOrdinal, filmMs)
  const cut = shot !== 0 && state.shot !== 0 && shot !== state.shot
  return {
    ...state,
    filmMs,
    shot,
    total: ordinals.size,
    cuts: state.cuts + (cut ? 1 : 0),
    realMs: state.realMs + delta
  }
}

export function projectionFinished(state: ProjectionState, scenes: readonly Scene[]): boolean {
  const bounds = filmBounds(scenes)
  if (!bounds) return true
  return state.filmMs >= bounds.end
}

export function setProjectionSpeed(state: ProjectionState, speed: ProjectionSpeed): ProjectionState {
  return { ...state, speed }
}

export function setProjectionSound(state: ProjectionState, sound: boolean): ProjectionState {
  return { ...state, sound }
}

export function exitProjection(state: ProjectionState): ProjectionState {
  return { ...state, active: false }
}

/** 每秒剪辑数：真实时间不足一秒时给 0，避免除零与夸张读数。 */
export function cutsPerSecond(state: ProjectionState): number {
  if (state.realMs < 250) return 0
  return state.cuts / (state.realMs / 1000)
}

/** 读数只在 600x / 3600x 下显示。 */
export function showCutRate(speed: ProjectionSpeed): boolean {
  return speed >= 600
}
