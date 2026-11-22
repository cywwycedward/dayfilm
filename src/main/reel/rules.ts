import type { Scene, Verdict } from '../../shared/types'

/** 一条采样代表它之后约 2 秒仍停留在同一窗口，镜头因此向后延伸一格。 */
export const SAMPLE_MS = 2000
/** 空闲阈值：与规格 R1.4 一致。 */
export const IDLE_MS = 60_000
/** 同一窗口超过这个间隔就算两个镜头（规格 R3.1）。 */
export const GAP_MS = 90_000
/** 少于 3 秒的瞬态切换不单独成镜（规格 R3.2）。 */
export const MIN_SHOT_MS = 3000
export const MAX_RESULTS = 200
export const HOUR_MS = 3_600_000
/** 活跃时长为 0 时避免除零。 */
export const MIN_ACTIVE_MS = 1e-6

/** 影片语言里的分钟数：四舍五入，有内容就至少 1 分钟。 */
export function minutesAtLeastOne(ms: number): number {
  return Math.max(1, Math.round(ms / 60000))
}

/** 把毫秒说成人话：`2 小时 15 分钟` / `48 分钟`。 */
export function formatDurationSpan(ms: number): string {
  // 与镜头行的分钟数同口径：有时长就至少报 1 分钟，否则会出现"活跃 0 分钟"却有镜头。
  const total = ms > 0 ? minutesAtLeastOne(ms) : 0
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return hours > 0 ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`
}

/** 按剪辑密度判定当天的题材（规格 R6.3）。 */
export function judge(cutRate: number, longest: { scene: Scene; ms: number } | null): Verdict {
  const label = cutRate < 3 ? '长镜头' : cutRate < 8 ? '标准剪辑' : cutRate <= 20 ? '快切' : '跳切风暴'
  const note = longest
    ? `最长的一个镜头是 ${longest.scene.exe || '未知进程'} 的 ${minutesAtLeastOne(longest.ms)} 分钟。`
    : '今天还没有形成长镜头。'
  return { label, note, cutRate }
}
