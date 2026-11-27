/** 上一集：跨天找同标题或同项目的窗口。纯函数 + 一个主进程查询入口。 */
import { matchProject } from '../../shared/projects'
import type { ProjectRule } from '../../shared/settings'
import type { DayRollup, EpisodeRef, Scene } from '../../shared/types'

/** 主进程查询的数据入口：保留范围、逐日读取、项目规则都由调用方给。 */
export interface EpisodeSource {
  /** 保留范围内的日期（主进程传 keptDays() 的实际结果） */
  retained(): string[]
  /** 读某一天的汇总（主进程传逐日 rollupFor，不预热、不扩缓存） */
  day(date: string): DayRollup
  /** 当前项目规则 */
  projects(): ProjectRule[]
}

/**
 * 纯函数：锚点在一天里的最后一次命中。
 * 匹配原始 `title` 完全相同（空标题不算）或与锚点属于同一项目；同一天多条取最后一条。
 */
export function lastEpisodeOf(anchor: Scene, day: DayRollup, rules: readonly ProjectRule[]): EpisodeRef | null {
  const project = matchProject(anchor, rules)
  let found: EpisodeRef | null = null
  for (const scene of day.scenes) {
    if (scene.kind !== 'shot') continue
    const sameTitle = anchor.title.length > 0 && scene.title === anchor.title
    const sameProject = !sameTitle && project !== null && matchProject(scene, rules) === project
    if (!sameTitle && !sameProject) continue
    found = {
      date: day.date,
      start: scene.start,
      exe: scene.exe,
      title: scene.title,
      seconds: scene.seconds,
      match: sameTitle ? 'title' : 'project',
      project: matchProject(scene, rules)
    }
  }
  return found
}

/**
 * 主进程查询入口：锚点 = 所查看日期的最长镜头（没有镜头 → null）。
 * 只看严格更早的保留日期，从近到远逐日读，命中第一天即停。
 */
export function previousEpisode(date: string, source: EpisodeSource): EpisodeRef | null {
  const anchor = source.day(date).longestShot
  if (anchor === null) return null
  const rules = source.projects()
  const earlier = source
    .retained()
    .filter((item) => item < date)
    .sort()
    .reverse()
  for (const candidate of earlier) {
    const hit = lastEpisodeOf(anchor, source.day(candidate), rules)
    if (hit !== null) return hit
  }
  return null
}
