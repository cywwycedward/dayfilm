/** 应用族色：12 个色相带，每带 30°，由进程名哈希决定。视觉语言 §3。 */
import { hashString } from './hash'

/** 进程族色带编号 0–11。同一 exe 永远落在同一带。 */
export function exeBand(exe: string): number {
  return hashString(exe.trim().toLowerCase()) % 12
}

/** 进程族的主色相，落在所属色带的前 24° 内。 */
export function exeHue(exe: string): number {
  return exeBand(exe) * 30 + (hashString(exe.trim().toLowerCase()) % 24)
}
