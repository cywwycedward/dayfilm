// 项目归属的纯函数：主进程与界面共用，避免两套口径。
import type { ProjectRule } from './settings'
import type { Scene } from './types'

export interface ProjectTotal {
  name: string
  ms: number
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

/** 返回命中的项目名；按规则顺序取第一条命中的。 */
export function matchProject(scene: Pick<Scene, 'exe' | 'title'>, rules: readonly ProjectRule[]): string | null {
  const exe = normalize(scene.exe)
  const title = normalize(scene.title)
  for (const rule of rules) {
    const name = rule.name.trim()
    if (name.length === 0) continue
    for (const term of rule.terms) {
      const needle = normalize(term)
      if (needle.length === 0) continue
      if (title.includes(needle) || exe.includes(needle)) return name
    }
  }
  return null
}

/** 按项目汇总镜头时长；未命中的镜头不计入。按总时长倒序。 */
export function totalByProject(scenes: readonly Scene[], rules: readonly ProjectRule[]): ProjectTotal[] {
  if (rules.length === 0) return []
  const totals = new Map<string, number>()
  for (const scene of scenes) {
    if (scene.kind !== 'shot') continue
    const name = matchProject(scene, rules)
    if (!name) continue
    totals.set(name, (totals.get(name) ?? 0) + (scene.end - scene.start))
  }
  return [...totals.entries()]
    .map(([name, ms]) => ({ name, ms }))
    .sort((a, b) => b.ms - a.ms)
}
