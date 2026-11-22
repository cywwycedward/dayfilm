/**
 * 程序化剧照的参数。改自同一个 (exe, title) 永远得到同一份参数，
 * 因此同一镜头在胶片、缩略图、放大帧里的画面完全一致。
 */
import { hashString, unitAt } from './hash'

export type StillShape = 'lines' | 'rings' | 'bars' | 'frame'

export interface StillSpec {
  seed: number
  shape: StillShape
  /** 主色相，取自进程族色带，度数 0–359 */
  hue: number
  /** 漏光与线条的辅助色相 */
  hueAccent: number
  /** 渐变角度，弧度 */
  angle: number
  /** 几何形状的重复次数 3–6 */
  bands: number
}

const SHAPES: StillShape[] = ['lines', 'rings', 'bars', 'frame']

/** 进程族色带编号 0–11，每个 30°。同一 exe 永远落在同一带。 */
export function exeBand(exe: string): number {
  return hashString(exe.trim().toLowerCase()) % 12
}

/** 进程族的主色相，落在所属色带的前 24°内。 */
export function exeHue(exe: string): number {
  return exeBand(exe) * 30 + (hashString(exe.trim().toLowerCase()) % 24)
}

export function stillSpec(exe: string, title: string): StillSpec {
  const seed = hashString(`${exe}|${title}`)
  const hue = (exeHue(exe) + Math.round(unitAt(seed, 7) * 10) - 5 + 360) % 360
  return {
    seed,
    shape: SHAPES[Math.floor(unitAt(seed, 1) * SHAPES.length)],
    hue,
    hueAccent: (hue + 140 + Math.round(unitAt(seed, 2) * 80)) % 360,
    angle: unitAt(seed, 3) * Math.PI * 2,
    bands: 3 + Math.floor(unitAt(seed, 4) * 4)
  }
}
