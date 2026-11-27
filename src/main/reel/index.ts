import type { DayRollup, Sample, Scene, SceneKind, SceneMark, TopApp } from '../../shared/types'
import { totalByProject } from '../../shared/projects'
import type { ProjectRule } from '../../shared/settings'
import { sameWindow, sceneKindOf, transitionOf } from './transition'
import {
  GAP_MS,
  HOUR_MS,
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
    const kind = sceneKindOf(sample)
    const same = kind === 'intermission' || (current !== null && sameWindow(current, sample))
    if (current && current.kind === kind && same && sample.t - current.lastT <= GAP_MS) {
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

/** 正在拍摄的镜头：取尾部同窗口的非空闲采样，不必等到满 3 秒成镜。 */
export function liveScene(samples: Sample[], day: DayRollup, date: string, now: number): Scene | null {
  const last = samples[samples.length - 1]
  if (!last || sceneKindOf(last) !== 'shot') return null
  let start = last.t
  for (let index = samples.length - 2; index >= 0; index -= 1) {
    const sample = samples[index]
    if (sceneKindOf(sample) !== 'shot' || !sameWindow(sample, last)) break
    if (last.t - sample.t > GAP_MS) break
    start = sample.t
  }
  // 与切分结果对齐时复用它的 id，界面才能高亮到胶片上的同一块。
  const match = day.scenes.find(
    (scene) => scene.kind === 'shot' && scene.start === start && scene.exe === last.exe && scene.title === last.title
  )
  const end = Math.max(now, last.t)
  return {
    id: match ? match.id : `${date}-live`,
    start,
    end,
    exe: last.exe,
    title: last.title,
    seconds: Math.round((end - start) / 1000),
    kind: 'shot'
  }
}

/**
 * 自动花絮规则：镜头时长短于阈值（**毫秒严格小于**）就算花絮，阈值 <= 0 表示关闭。
 * 用毫秒而不是 `Scene.seconds`：后者是四舍五入过的，3.4s 会被舍成 3。
 */
export function isAutoExtra(ms: number, autoExtraUnderSec: number): boolean {
  return Number.isFinite(autoExtraUnderSec) && autoExtraUnderSec > 0 && ms < autoExtraUnderSec * 1000
}

/**
 * 把标记应用到镜头上并重算正片/花絮时长。
 * 手动标记优先；没有手动标记且短于自动阈值时算自动花絮（`markSource: 'auto'`）；
 * 其余（含手动标正片）都计入正片。
 */
export function applyMarks(
  rollup: DayRollup,
  marks: Record<string, SceneMark> | undefined,
  autoExtraUnderSec = 0
): DayRollup {
  const hasMarks = Boolean(marks && Object.keys(marks).length > 0)
  const autoOn = Number.isFinite(autoExtraUnderSec) && autoExtraUnderSec > 0
  if (!hasMarks && !autoOn) return rollup

  let featureMs = 0
  let extraMs = 0
  const scenes = rollup.scenes.map((scene): Scene => {
    if (scene.kind === 'intermission') return scene
    const ms = scene.end - scene.start
    const manual = marks?.[String(scene.start)]
    if (manual === 'extra') {
      extraMs += ms
      return { ...scene, mark: 'extra', markSource: 'manual' }
    }
    if (manual === 'feature') {
      featureMs += ms
      return { ...scene, mark: 'feature', markSource: 'manual' }
    }
    if (autoOn && isAutoExtra(ms, autoExtraUnderSec)) {
      extraMs += ms
      return { ...scene, mark: 'extra', markSource: 'auto' }
    }
    featureMs += ms
    return scene
  })
  return { ...rollup, scenes, featureMs, extraMs }
}

export interface RollupOptions {
  /** 手动标记：镜头开始时刻（毫秒字符串）→ 标记 */
  marks?: Record<string, SceneMark>
  /** 短于这么多秒的镜头自动算花絮；0 表示关闭 */
  autoExtraUnderSec?: number
}

/** 采样 → 一天的镜头、汇总与题材。纯函数，同输入同输出。 */
export function buildDayRollup(samples: Sample[], date: string, now: number, options: RollupOptions = {}): DayRollup {
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

  let appCuts = 0
  let withinAppCuts = 0
  for (let index = 1; index < shots.length; index += 1) {
    const transition = transitionOf(shots[index - 1].scene, shots[index].scene)
    if (transition === 'app') appCuts += 1
    else if (transition === 'within-app') withinAppCuts += 1
  }
  const cuts = appCuts + withinAppCuts

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

  const base: DayRollup = {
    date,
    firstAt: ordered.length > 0 ? ordered[0].t : null,
    lastAt: ordered.length > 0 ? ordered[ordered.length - 1].t : null,
    activeMs,
    idleMs,
    scenes: kept.map((item) => item.scene),
    cuts,
    appCuts,
    withinAppCuts,
    longestShot: longest ? longest.scene : null,
    topApps,
    verdict: judge(cutRate, longest),
    // 未标记时全部算正片；标记由 applyMarks 覆盖
    featureMs: activeMs,
    extraMs: 0
  }
  return applyMarks(base, options.marks, options.autoExtraUnderSec ?? 0)
}

/** 检索在 `./search` 里：归一化 + 多词 AND + 时间词。这里保持原有导出，调用方不用改。 */
export { searchScenes } from './search'

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
  lines.push(`正片 ${formatDurationSpan(day.featureMs)} · 花絮 ${formatDurationSpan(day.extraMs)}`)

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
