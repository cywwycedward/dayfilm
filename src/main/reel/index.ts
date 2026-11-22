import type { DayRollup, Sample, Scene, SceneKind, TopApp } from '../../shared/types'
import { totalByProject } from '../../shared/projects'
import type { ProjectRule } from '../../shared/settings'
import {
  GAP_MS,
  HOUR_MS,
  IDLE_MS,
  MAX_RESULTS,
  MIN_ACTIVE_MS,
  MIN_SHOT_MS,
  SAMPLE_MS,
  formatDurationSpan,
  judge,
  minutesAtLeastOne
} from './rules'

interface Run {
  kind: SceneKind
  exe: string
  title: string
  firstT: number
  lastT: number
}

/** 同一 t 保留先出现的一条，再按时间升序排列；排序后 t 唯一，结果稳定。 */
export function orderSamples(samples: readonly Sample[]): Sample[] {
  // 日文件是只追加的，从磁盘读回来几乎总是严格递增；此时排序与去重都是空操作。
  let ordered = true
  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index].t <= samples[index - 1].t) {
      ordered = false
      break
    }
  }
  if (ordered) return [...samples]

  const seen = new Set<number>()
  const unique: Sample[] = []
  for (const sample of samples) {
    if (seen.has(sample.t)) continue
    seen.add(sample.t)
    unique.push(sample)
  }
  return unique.sort((a, b) => a.t - b.t)
}

/** 把采样连成"同窗口"或"同空闲"的连续区间，此时还不判断时长。 */
function groupRuns(samples: Sample[]): Run[] {
  const runs: Run[] = []
  let current: Run | null = null
  for (const sample of samples) {
    const kind: SceneKind = sample.idleMs >= IDLE_MS ? 'intermission' : 'shot'
    const sameWindow = kind === 'intermission' || (current?.exe === sample.exe && current?.title === sample.title)
    if (current && current.kind === kind && sameWindow && sample.t - current.lastT <= GAP_MS) {
      current.lastT = sample.t
      continue
    }
    current = {
      kind,
      exe: kind === 'shot' ? sample.exe : '',
      title: kind === 'shot' ? sample.title : '',
      firstT: sample.t,
      lastT: sample.t
    }
    runs.push(current)
  }
  return runs
}

/** 镜头向后延伸一格采样；中场休息不外延，空闲到 now 时停在最后一次采样。 */
function sceneEnd(run: Run, next: Run | undefined, now: number): number {
  if (run.kind === 'intermission') return run.lastT
  const limit = next ? next.firstT : now
  return Math.max(run.firstT, Math.min(run.lastT + SAMPLE_MS, limit))
}

/** 采样 → 一天的镜头、汇总与题材。纯函数，同输入同输出。 */
export function buildDayRollup(samples: Sample[], date: string, now: number): DayRollup {
  const ordered = orderSamples(samples)
  const runs = groupRuns(ordered)
  const kept: Array<{ scene: Scene; ms: number }> = []

  runs.forEach((run, index) => {
    const start = run.firstT
    const end = sceneEnd(run, runs[index + 1], now)
    const ms = end - start
    if (run.kind === 'shot' ? ms < MIN_SHOT_MS : ms <= 0) return
    kept.push({
      ms,
      scene: {
        id: `${date}-${kept.length + 1}`,
        start,
        end,
        exe: run.exe,
        title: run.title,
        seconds: Math.round(ms / 1000),
        kind: run.kind
      }
    })
  })

  const shots = kept.filter((item) => item.scene.kind === 'shot')
  const activeMs = shots.reduce((total, item) => total + item.ms, 0)
  const idleMs = kept.reduce((total, item) => (item.scene.kind === 'intermission' ? total + item.ms : total), 0)

  let cuts = 0
  for (let index = 1; index < shots.length; index += 1) {
    const prev = shots[index - 1].scene
    const curr = shots[index].scene
    if (prev.exe !== curr.exe || prev.title !== curr.title) cuts += 1
  }

  let longest: { scene: Scene; ms: number } | null = null
  for (const shot of shots) {
    if (!longest || shot.ms > longest.ms) longest = shot
  }

  const totals = new Map<string, number>()
  for (const shot of shots) {
    totals.set(shot.scene.exe, (totals.get(shot.scene.exe) ?? 0) + shot.ms)
  }
  const topApps: TopApp[] = [...totals.entries()]
    .map(([exe, ms]) => ({ exe, ms }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5)
    .map(({ exe, ms }) => ({ exe, seconds: Math.round(ms / 1000) }))

  const cutRate = cuts / Math.max(activeMs / HOUR_MS, MIN_ACTIVE_MS)

  return {
    date,
    firstAt: ordered.length > 0 ? ordered[0].t : null,
    lastAt: ordered.length > 0 ? ordered[ordered.length - 1].t : null,
    activeMs,
    idleMs,
    scenes: kept.map((item) => item.scene),
    cuts,
    longestShot: longest ? longest.scene : null,
    topApps,
    verdict: judge(cutRate, longest)
  }
}

/** 标题与进程名的子串匹配，不区分大小写；跨日期合并后按开始时间倒序，最多 200 条。 */
export function searchScenes(query: string, days: DayRollup[]): Scene[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return []
  const hits: Scene[] = []
  for (const day of days) {
    for (const scene of day.scenes) {
      if (scene.title.toLowerCase().includes(needle) || scene.exe.toLowerCase().includes(needle)) hits.push(scene)
    }
  }
  return hits.sort((a, b) => b.start - a.start).slice(0, MAX_RESULTS)
}

function clock(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export interface ScreenplayOptions {
  /** 当天导演手记，有内容时写在标题行之后（规格 R26.1） */
  note?: string
  /** 项目规则，有命中时在题材段后加一行项目时长 */
  projects?: readonly ProjectRule[]
}

const PROJECT_LINES = 3

/** 一天的 Markdown 剧本：标题行、（手记）、题材与汇总、（项目）、每个镜头一行。 */
export function renderScreenplay(day: DayRollup, options: ScreenplayOptions = {}): string {
  const shotCount = day.scenes.filter((scene) => scene.kind === 'shot').length
  const lines = [`# ${day.date} · Dayfilm 剧本`, '']

  const note = options.note?.trim() ?? ''
  if (note.length > 0) lines.push(`> 导演手记：${note}`, '')

  lines.push(
    `题材：${day.verdict.label}。${day.verdict.note}活跃 ${formatDurationSpan(day.activeMs)}，中场休息 ${formatDurationSpan(day.idleMs)}，${shotCount} 个镜头，${day.cuts} 次剪辑。`
  )

  const projects = options.projects && options.projects.length > 0 ? totalByProject(day.scenes, options.projects) : []
  if (projects.length > 0) {
    const parts = projects
      .slice(0, PROJECT_LINES)
      .map((project) => `${project.name} ${minutesAtLeastOne(project.ms)} 分钟`)
    lines.push(`项目：${parts.join(' · ')}`)
  }

  lines.push('')

  for (const scene of day.scenes) {
    const range = `[${clock(scene.start)}–${clock(scene.end)}]`
    const duration = `${minutesAtLeastOne(scene.end - scene.start)}m`
    lines.push(
      scene.kind === 'intermission' ? `- ${range} （中场休息 ${duration}）` : `- ${range} ${scene.exe} · ${scene.title}（${duration}）`
    )
  }
  return `${lines.join('\n')}\n`
}
