import type { SceneKind } from '../../shared/types'
import { IDLE_MS } from './rules'

/** 窗口身份：进程名 + 原始标题。采样、镜头、聚合区间都用同一份判定。 */
export interface WindowId {
  exe: string
  title: string
}

export function sameWindow(a: WindowId, b: WindowId): boolean {
  return a.exe === b.exe && a.title === b.title
}

/** Windows 锁屏时前台窗口是 LockApp（标题是本地化的「Windows 默认锁屏界面」）。 */
const LOCK_SCREEN_EXE = 'lockapp'

/** away：没有前台窗口（空进程名与空标题），或前台就是锁屏界面。 */
export function isAway(sample: WindowId): boolean {
  const exe = sample.exe.trim().toLowerCase()
  if (exe === LOCK_SCREEN_EXE) return true
  return exe === '' && sample.title.trim() === ''
}

/** away 直接算中场休息，不看 60 秒门槛；其余按空闲毫秒。 */
export function sceneKindOf(sample: WindowId & { idleMs: number }): SceneKind {
  return isAway(sample) || sample.idleMs >= IDLE_MS ? 'intermission' : 'shot'
}

/** 相邻两个有效镜头的切换种类。中场休息由调用方先行排除。 */
export function transitionOf(prev: WindowId, next: WindowId): 'app' | 'within-app' | 'none' {
  if (prev.exe !== next.exe) return 'app'
  return prev.title !== next.title ? 'within-app' : 'none'
}
