/**
 * 一周电影：把七天当成七个幕，算主线、故事线、剧情标记、周评语。
 * 纯函数，只在这里定义"周"的口径（周一为起点、项目优先、并列按名称）。
 */
import { matchProject, totalByProject } from '../../../shared/projects'
import type { ProjectRule } from '../../../shared/settings'
import type { DayRollup, Scene } from '../../../shared/types'
import { hashString } from './hash'
import { fmtDuration, fmtMinutes, isoDate, startOfDay } from './time'

const HOUR_MS = 3_600_000
export const PICK_WINDOW_MS = 30 * 60_000

export type WeekLineKind = 'project' | 'app'

export interface WeekDay {
  date: string
  day: DayRollup | null
}

export interface WeekEntry {
  date: string
  scene: Scene
}

export interface WeekLine {
  name: string
  ms: number
  kind: WeekLineKind
}

export interface WeekMetrics {
  longestSeconds: number
  /** 每小时剪辑数 */
  cutRate: number
  activeMs: number
  cuts: number
  shots: number
}

export interface StorylineCell {
  date: string
  ms: number
  /** 0–1，按该行周最大值平方根压缩 */
  level: number
  /** 四档透明度之一，0 表示无命中 */
  alpha: number
  /** 该项目当天无命中 */
  empty: boolean
  /** 整列没有采集 */
  noRecord: boolean
  /** 今天之后的日期 */
  future: boolean
  /** 当天主角（时长第一的项目/进程） */
  protagonist: boolean
  /** 与前一天同一主角：在格子间隙画一段短线 */
  link: boolean
}

export interface StorylineRow {
  line: string
  kind: WeekLineKind
  /** 项目身份色相（一周内固定） */
  hue: number
  totalMs: number
  cells: StorylineCell[]
}

/** 矩阵的一列：日期与当天的剧情标记（切 / 回 / 无记录）。 */
export interface StoryColumn {
  date: string
  weekday: string
  future: boolean
  noRecord: boolean
  /** 当天主角的项目名；有记录但没有项目命中时为 null */
  protagonist: string | null
  /** 主角变化：切 = 换到新主角，回 = 回到本周早前的主角 */
  mark: '切' | '回' | null
}

/** 格子填充的四档透明度 */
export const STORY_ALPHA = [0.25, 0.42, 0.62, 0.82] as const
/** 当天主角的描边色 */
export const PROTAGONIST_STROKE = '#e9ddc6'
/** 该项目当天无命中的暗格 */
export const EMPTY_CELL = '#202226'

export interface ActBadge {
  kind: 'run' | 'switch'
  text: string
}

export interface ActModel {
  date: string
  weekday: string
  /** 今天之后的日期：不统计，也不显示为 0 */
  future: boolean
  hasData: boolean
  mainLine: string | null
  kind: WeekLineKind | null
  longestSeconds: number
  cuts: number
  shots: number
  /** 当天花絮总时长（含自动），0 时不显示 */
  extraMs: number
  badges: ActBadge[]
}

export interface WeekFilm {
  monday: string
  dates: string[]
  acts: ActModel[]
  rows: StorylineRow[]
  columns: StoryColumn[]
  /** 一周内的镜头，按开始时间升序 */
  entries: WeekEntry[]
  metrics: WeekMetrics
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function weekdayLabel(dateISO: string): string {
  return WEEKDAY_LABELS[new Date(startOfDay(dateISO)).getDay()]
}

/** 所在自然周的周一（本地时区，周一为起点）。非法日期原样返回。 */
export function mondayOf(dateISO: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return dateISO
  const base = new Date(startOfDay(dateISO))
  base.setDate(base.getDate() - ((base.getDay() + 6) % 7))
  return isoDate(base.getTime())
}

/** 从周一开始的 7 个日期，升序。 */
export function weekDates(mondayISO: string): string[] {
  const base = new Date(startOfDay(mondayISO))
  const dates: string[] = []
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(base)
    day.setDate(day.getDate() + offset)
    dates.push(isoDate(day.getTime()))
  }
  return dates
}

/** 周范围文字：11月16日 – 11月22日；跨年时带年份。 */
export function weekRangeLabel(mondayISO: string): string {
  const dates = weekDates(mondayISO)
  const monday = new Date(startOfDay(dates[0]))
  const sunday = new Date(startOfDay(dates[6]))
  const left =
    monday.getFullYear() === sunday.getFullYear()
      ? `${monday.getMonth() + 1}月${monday.getDate()}日`
      : `${monday.getFullYear()}年${monday.getMonth() + 1}月${monday.getDate()}日`
  return `${left} – ${sunday.getMonth() + 1}月${sunday.getDate()}日`
}

function pickTop(items: readonly { name: string; ms: number }[]): { name: string; ms: number } | null {
  let best: { name: string; ms: number } | null = null
  for (const item of items) {
    if (!(item.ms > 0)) continue
    if (best === null || item.ms > best.ms || (item.ms === best.ms && item.name < best.name)) best = item
  }
  return best
}

/** 正片镜头：花絮（手动或自动）不计入周主线与统计。 */
function featureScenes(day: DayRollup): Scene[] {
  return day.scenes.filter((scene) => scene.kind === 'shot' && scene.mark !== 'extra')
}

/** 某天正片镜头之间的剪辑数（有花絮时才需要重算）。 */
function featureCuts(day: DayRollup): number {
  return Math.max(0, featureScenes(day).length - 1)
}

function hasExtra(day: DayRollup): boolean {
  return day.scenes.some((scene) => scene.mark === 'extra')
}

/** 某天的主线：项目优先；没有项目规则时用进程名；并列按名称字典序。 */
export function mainLineOf(day: DayRollup | null, projects: readonly ProjectRule[]): WeekLine | null {
  if (!day) return null
  const scenes = day.scenes.filter((scene) => scene.mark !== 'extra')
  if (projects.length > 0) {
    const top = pickTop(totalByProject(scenes, projects).map((item) => ({ name: item.name, ms: item.ms })))
    return top ? { name: top.name, ms: top.ms, kind: 'project' } : null
  }
  const totals = new Map<string, number>()
  for (const scene of scenes) {
    if (scene.kind !== 'shot') continue
    totals.set(scene.exe, (totals.get(scene.exe) ?? 0) + (scene.end - scene.start))
  }
  const top = pickTop([...totals].map(([name, ms]) => ({ name, ms })))
  return top ? { name: top.name, ms: top.ms, kind: 'app' } : null
}

/** 有数据的镜头（今天之后的日子不算）。 */
export function weekEntries(days: readonly WeekDay[], today?: string): WeekEntry[] {
  const entries: WeekEntry[] = []
  for (const { date, day } of days) {
    if (!day) continue
    if (today !== undefined && date > today) continue
    for (const scene of day.scenes) {
      if (scene.kind === 'shot' && scene.mark !== 'extra') entries.push({ date, scene })
    }
  }
  return entries.sort((a, b) => a.scene.start - b.scene.start)
}

export function weekMetrics(days: readonly WeekDay[], today?: string): WeekMetrics {
  let activeMs = 0
  let cuts = 0
  for (const { date, day } of days) {
    if (!day) continue
    if (today !== undefined && date > today) continue
    activeMs += hasExtra(day) ? day.featureMs : day.activeMs
    cuts += hasExtra(day) ? featureCuts(day) : day.cuts
  }
  const entries = weekEntries(days, today)
  let longestSeconds = 0
  for (const entry of entries) longestSeconds = Math.max(longestSeconds, entry.scene.seconds)
  const hours = activeMs / HOUR_MS
  return {
    longestSeconds,
    cutRate: hours > 0 ? cuts / hours : 0,
    activeMs,
    cuts,
    shots: entries.length
  }
}

function protagonistOf(day: DayRollup | null, projects: readonly ProjectRule[]): string | null {
  return mainLineOf(day, projects)?.name ?? null
}

/** 项目身份色相：名字决定，一周内不变；同周撞色时按固定步长错开。 */
function assignHues(names: readonly string[]): Map<string, number> {
  const used = new Set<number>()
  const hues = new Map<string, number>()
  for (const name of names) {
    let hue = hashString(name) % 360
    while (used.has(hue)) hue = (hue + 29) % 360
    used.add(hue)
    hues.set(name, hue)
  }
  return hues
}

/** 每一列的日期与剧情标记：切 = 换到新主角，回 = 回到本周早前的主角。 */
function buildColumns(
  days: readonly WeekDay[],
  projects: readonly ProjectRule[],
  today: string,
  previousSunday: WeekDay | null | undefined
): StoryColumn[] {
  const protagonists = days.map(({ day }) => protagonistOf(day, projects))
  let before = previousSunday ? protagonistOf(previousSunday.day, projects) : null
  return days.map(({ date, day }, index) => {
    const protagonist = protagonists[index]
    const future = date > today
    let mark: StoryColumn['mark'] = null
    if (!future && protagonist !== null && before !== null && protagonist !== before) {
      const seen = protagonists.slice(0, index).some((name) => name === protagonist)
      mark = seen ? '回' : '切'
    }
    before = protagonist
    return {
      date,
      weekday: weekdayLabel(date),
      future,
      // 未来日期还没到，不算“整天没有采集”
      noRecord: !future && (day === null || day.scenes.length === 0),
      protagonist,
      mark
    }
  })
}

function buildStoryline(
  days: readonly WeekDay[],
  projects: readonly ProjectRule[],
  today: string,
  columns: readonly StoryColumn[]
): StorylineRow[] {
  const perDay = new Map<string, Map<string, number>>()
  for (const { date, day } of days) {
    if (!day || date > today) continue
    const lines = new Map<string, number>()
    if (projects.length > 0) {
      for (const item of totalByProject(
        day.scenes.filter((scene) => scene.mark !== 'extra'),
        projects
      ))
        lines.set(item.name, item.ms)
    } else {
      for (const scene of day.scenes) {
        if (scene.kind !== 'shot' || scene.mark === 'extra') continue
        lines.set(scene.exe, (lines.get(scene.exe) ?? 0) + (scene.end - scene.start))
      }
    }
    perDay.set(date, lines)
  }

  const totals = new Map<string, number>()
  for (const lines of perDay.values()) {
    for (const [name, ms] of lines) totals.set(name, (totals.get(name) ?? 0) + ms)
  }
  const kind: WeekLineKind = projects.length > 0 ? 'project' : 'app'
  const ordered = [...totals.entries()].filter(([, ms]) => ms > 0)
  ordered.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    if (a[0] === b[0]) return 0
    return a[0] < b[0] ? -1 : 1
  })
  const top = ordered.slice(0, 5)
  const hues = assignHues(top.map(([line]) => line))
  return top.map(([line, totalMs]) => {
    const values = days.map(({ date }) => perDay.get(date)?.get(line) ?? 0)
    const max = Math.max(0, ...values)
    return {
      line,
      kind,
      hue: hues.get(line) ?? 0,
      totalMs,
      cells: days.map(({ date }, index) => {
        const ms = values[index]
        const level = ms > 0 && max > 0 ? Math.sqrt(Math.min(1, ms / max)) : 0
        const tier = Math.min(STORY_ALPHA.length - 1, Math.floor(level * STORY_ALPHA.length))
        const column = columns[index]
        const previousProtagonist = index === 0 ? null : columns[index - 1].protagonist
        return {
          date,
          ms,
          level,
          alpha: level > 0 ? STORY_ALPHA[tier] : 0,
          empty: ms <= 0,
          noRecord: column.noRecord,
          future: column.future,
          protagonist: column.protagonist === line,
          link: index > 0 && column.protagonist === line && previousProtagonist === line
        }
      })
    }
  })
}

function badgesFor(
  acts: ActModel[],
  rows: readonly StorylineRow[],
  previousSunday: WeekDay | null | undefined,
  projects: readonly ProjectRule[]
): void {
  // 长主线：同一主线连续 >= 3 天，标在这一段最后一幕
  let runStart = 0
  for (let index = 1; index <= acts.length; index += 1) {
    const same = index < acts.length && acts[index].mainLine !== null && acts[index].mainLine === acts[runStart].mainLine
    if (same) continue
    const length = index - runStart
    const line = acts[runStart].mainLine
    if (line !== null && length >= 3) {
      acts[index - 1].badges.push({ kind: 'run', text: `${line} · 连续 ${length} 天` })
    }
    runStart = index
  }

  // 换戏：与前一天主线不同，且当天主线在本周时长排行前二
  const rank = new Map<string, number>()
  for (let index = 0; index < rows.length; index += 1) rank.set(rows[index].line, index)
  const previousLine = previousSunday ? mainLineOf(previousSunday.day, projects) : null
  acts.forEach((act, index) => {
    if (act.future || act.mainLine === null) return
    const before = index === 0 ? (previousLine?.name ?? null) : acts[index - 1].mainLine
    if (before === null || before === act.mainLine) return
    const position = rank.get(act.mainLine)
    if (position === undefined || position > 1) return
    act.badges.push({ kind: 'switch', text: '换戏' })
  })
}

export interface WeekFilmInput {
  /** 周一到周日，7 天 */
  days: readonly WeekDay[]
  projects: readonly ProjectRule[]
  today: string
  /** 上周日，用来判断第一幕是否换戏 */
  previousSunday?: WeekDay | null
}

export function buildWeekFilm(input: WeekFilmInput): WeekFilm {
  const days = input.days
  const monday = days[0]?.date ?? mondayOf(input.today)
  const acts: ActModel[] = days.map(({ date, day }) => {
    const future = date > input.today
    const usable = day !== null && !future ? day : null
    const line = mainLineOf(usable, input.projects)
    const shots = usable ? featureScenes(usable) : []
    const extraMs = usable
      ? usable.scenes
          .filter((scene) => scene.mark === 'extra')
          .reduce((sum, scene) => sum + scene.seconds * 1000, 0)
      : 0
    return {
      date,
      weekday: weekdayLabel(date),
      future,
      hasData: shots.length > 0,
      mainLine: line?.name ?? null,
      kind: line?.kind ?? null,
      longestSeconds: shots.reduce((longest, scene) => Math.max(longest, scene.seconds), 0),
      cuts: usable ? (hasExtra(usable) ? featureCuts(usable) : usable.cuts) : 0,
      shots: shots.length,
      extraMs,
      badges: []
    }
  })
  const columns = buildColumns(days, input.projects, input.today, input.previousSunday)
  const rows = buildStoryline(days, input.projects, input.today, columns)
  badgesFor(acts, rows, input.previousSunday, input.projects)
  return {
    monday,
    dates: days.map(({ date }) => date),
    acts,
    rows,
    columns,
    entries: weekEntries(days, input.today),
    metrics: weekMetrics(days, input.today)
  }
}

/* 周导演评语 --------------------------------------------------------- */

export interface EvidenceRow {
  label: string
  current: string
  previous: string
  delta: string
}

export interface WeekVerdict {
  sentence: string
  evidence: EvidenceRow[]
  hasPrevious: boolean
}

interface Comparison {
  metric: 'longest' | 'cutRate' | 'active'
  label: string
  current: string
  previous: string
  delta: string
  magnitude: number
  up: boolean
  changed: boolean
}

function relativeChange(current: number, previous: number): number {
  if (previous > 0) return (current - previous) / previous
  return current > 0 ? Number.POSITIVE_INFINITY : 0
}

function signedDuration(ms: number, up: boolean): string {
  return `${up ? '+' : '−'}${fmtMinutes(Math.abs(ms))}`
}

export function buildWeekVerdict(
  thisDays: readonly WeekDay[],
  lastDays: readonly WeekDay[],
  today?: string
): WeekVerdict {
  const current = weekMetrics(thisDays, today)
  const previous = weekMetrics(lastDays, today)
  const hasPrevious = previous.shots > 0

  const comparisons: Comparison[] = [
    {
      metric: 'longest',
      label: '最长镜头',
      current: fmtDuration(current.longestSeconds),
      previous: hasPrevious ? fmtDuration(previous.longestSeconds) : '—',
      delta: hasPrevious
        ? signedDuration(
            (Math.abs(current.longestSeconds - previous.longestSeconds) || 0) * 1000,
            current.longestSeconds >= previous.longestSeconds
          )
        : '—',
      magnitude: Math.abs(relativeChange(current.longestSeconds, previous.longestSeconds)),
      up: current.longestSeconds >= previous.longestSeconds,
      changed: hasPrevious && current.longestSeconds !== previous.longestSeconds
    },
    {
      metric: 'cutRate',
      label: '剪辑密度',
      current: `每小时 ${current.cutRate.toFixed(1)} 次`,
      previous: hasPrevious ? `每小时 ${previous.cutRate.toFixed(1)} 次` : '—',
      delta: hasPrevious
        ? `${current.cutRate >= previous.cutRate ? '+' : '−'}${Math.abs(current.cutRate - previous.cutRate).toFixed(1)} 次/小时`
        : '—',
      magnitude: Math.abs(relativeChange(current.cutRate, previous.cutRate)),
      up: current.cutRate >= previous.cutRate,
      changed: hasPrevious && Math.abs(current.cutRate - previous.cutRate) > 0.05
    },
    {
      metric: 'active',
      label: '活跃时长',
      current: fmtMinutes(current.activeMs),
      previous: hasPrevious ? fmtMinutes(previous.activeMs) : '—',
      delta: hasPrevious
        ? signedDuration(Math.abs(current.activeMs - previous.activeMs), current.activeMs >= previous.activeMs)
        : '—',
      magnitude: Math.abs(relativeChange(current.activeMs, previous.activeMs)),
      up: current.activeMs >= previous.activeMs,
      changed: hasPrevious && current.activeMs !== previous.activeMs
    }
  ]

  const evidence: EvidenceRow[] = comparisons.map((item) => ({
    label: item.label,
    current: item.current,
    previous: item.previous,
    delta: hasPrevious ? item.delta : '—'
  }))

  // 本周花絮占比 > 10% 时补一句（只算花絮镜头，不含中场休息）
  const extraMs = thisDays.reduce((sum, { day }) => {
    if (!day) return sum
    return (
      sum +
      day.scenes
        .filter((scene) => scene.mark === 'extra')
        .reduce((acc, scene) => acc + scene.seconds * 1000, 0)
    )
  }, 0)
  const totalMs = current.activeMs + extraMs
  const extraShare = totalMs > 0 ? extraMs / totalMs : 0
  const extraClause = extraShare > 0.1 ? `；其中花絮占 ${Math.round(extraShare * 100)}%。` : null

  if (!hasPrevious) {
    return { sentence: '这是第一周，还没有可以对比的上周。', evidence, hasPrevious }
  }

  const ranked = comparisons
    .filter((item) => item.changed)
    .sort((a, b) => (b.magnitude === a.magnitude ? 0 : b.magnitude - a.magnitude))
  if (ranked.length === 0) {
    const base = `本周与上周基本一样：最长镜头 ${current.longestSeconds > 0 ? fmtDuration(current.longestSeconds) : '—'}，剪辑密度每小时 ${current.cutRate.toFixed(1)} 次，活跃时长 ${fmtMinutes(current.activeMs)}。`
    return { sentence: extraClause ? base.replace(/。$/, `${extraClause}`) : base, evidence, hasPrevious }
  }

  const clauses = ranked.slice(0, 2).map((item) => {
    if (item.metric === 'longest') {
      const diff = Math.abs(current.longestSeconds - previous.longestSeconds)
      return item.up
        ? `本周最长镜头是 ${fmtDuration(current.longestSeconds)}，比上周多 ${fmtDuration(diff)}`
        : `本周最长镜头是 ${fmtDuration(current.longestSeconds)}，比上周少 ${fmtDuration(diff)}`
    }
    if (item.metric === 'cutRate') {
      return item.up
        ? `剪辑密度升到每小时 ${current.cutRate.toFixed(1)} 次`
        : `剪辑密度降到每小时 ${current.cutRate.toFixed(1)} 次`
    }
    const diff = Math.abs(current.activeMs - previous.activeMs)
    return item.up
      ? `活跃时长比上周多 ${fmtMinutes(diff)}`
      : `活跃时长比上周少 ${fmtMinutes(diff)}`
  })

  const sentence = clauses.join('；')
  return {
    sentence: extraClause ? `${sentence}${extraClause}` : `${sentence}。`,
    evidence,
    hasPrevious
  }
}

/* 本周精选 ----------------------------------------------------------- */

export interface WeekPick {
  reason: string
  date: string
  scene: Scene
}

function lineOf(scene: Scene, projects: readonly ProjectRule[], kind: WeekLineKind): string | null {
  if (kind === 'project') return matchProject(scene, projects)
  return scene.exe.length > 0 ? scene.exe : null
}

function firstEntryOfLine(entries: readonly WeekEntry[], line: string, kind: WeekLineKind, projects: readonly ProjectRule[]): WeekEntry | null {
  for (const entry of entries) {
    if (lineOf(entry.scene, projects, kind) === line) return entry
  }
  return null
}

export function pickWeekHighlights(film: WeekFilm, projects: readonly ProjectRule[]): WeekPick[] {
  const entries = film.entries
  if (entries.length === 0) return []

  const picks: WeekPick[] = []
  const seen = new Set<string>()
  const push = (entry: WeekEntry, reason: string): void => {
    const key = `${entry.date}|${entry.scene.start}`
    if (seen.has(key) || picks.length >= 7) return
    seen.add(key)
    picks.push({ reason, date: entry.date, scene: entry.scene })
  }

  // 1. 本周最长镜头（并列取更早）
  let longest = entries[0]
  for (const entry of entries) {
    if (entry.scene.seconds > longest.scene.seconds) longest = entry
  }
  push(longest, '本周最长镜头')

  // 2. 最密 30 分钟窗口里最长的镜头（按天分窗，不跨零点）
  let bestWindow: { entries: WeekEntry[]; count: number } | null = null
  for (const anchor of entries) {
    const window = entries.filter(
      (entry) => entry.date === anchor.date && entry.scene.start >= anchor.scene.start && entry.scene.start < anchor.scene.start + PICK_WINDOW_MS
    )
    if (window.length === 0) continue
    if (bestWindow === null || window.length > bestWindow.count) bestWindow = { entries: window, count: window.length }
  }
  if (bestWindow !== null) {
    let busiest = bestWindow.entries[0]
    for (const entry of bestWindow.entries) {
      if (entry.scene.seconds > busiest.scene.seconds) busiest = entry
    }
    push(busiest, '最密的 30 分钟')
  }

  // 3. 各故事线本周第一次登场
  const kind: WeekLineKind = projects.length > 0 ? 'project' : 'app'
  for (const row of film.rows) {
    const entry = firstEntryOfLine(entries, row.line, kind, projects)
    if (entry) push(entry, `${row.line} 本周登场`)
  }

  // 4. 每次换戏当天的第一个镜头
  for (const act of film.acts) {
    if (!act.badges.some((badge) => badge.kind === 'switch')) continue
    const first = entries.find((entry) => entry.date === act.date)
    if (first) push(first, `换戏 · ${act.mainLine ?? '新主线'}`)
  }

  // 5. 本周最后一个镜头
  push(entries[entries.length - 1], '本周最后一镜')

  return picks
}
