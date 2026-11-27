/** 检索：归一化 + 多词 AND + 时间词 + 保留范围对齐。纯函数，同一份数据同一份结果。 */
import { normalizeTitle, toHalfWidth } from '../../shared/stories'
import type { DayRollup, Scene, SearchCoverage, SearchOutcome, SearchReason } from '../../shared/types'
import { MAX_RESULTS } from './rules'

const DAY_MS = 86_400_000
/** 没有时间词时回看的天数（含今天）。 */
const RECENT_DAYS = 7
const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const
const TOKEN_SPLIT = /[\s,，、;；]+/u
const DATE_IN_QUERY = /\d{4}-\d{2}-\d{2}/u
const MONTH_DAY = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/u

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 本地日期字符串（与日文件名同口径）。 */
function isoOf(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function startOfDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** 所在自然周的周一零点。 */
function mondayOf(ms: number): number {
  const day = startOfDay(ms)
  const weekday = (new Date(day).getDay() + 6) % 7
  return day - weekday * DAY_MS
}

/** 从周一起的 7 个日期。 */
function weekDates(monday: number): string[] {
  const dates: string[] = []
  for (let offset = 0; offset < 7; offset += 1) dates.push(isoOf(monday + offset * DAY_MS))
  return dates
}

export interface ParsedQuery {
  /** 标题里要同时命中的词（小写） */
  tokens: string[]
  /** 时间词解析出的日期集合；null 表示查询里没有时间词 */
  dates: string[] | null
}

/**
 * 把 `上周三 那个 pdf` 拆成时间过滤 + 标题词。
 * 解析不出来的日期词（`2月30日`）当普通词处理，不报错。
 */
export function parseQuery(query: string, now = Date.now()): ParsedQuery {
  let rest = query
  const dates = new Set<string>()
  let sawTimeWord = false

  // 每次只取第一处命中：这些时间词互不重叠，逐个从查询里剥离即可（避免 replace 回调的类型体操）。
  // apply 返回 false 表示这个词解析不出日期：不剥离，留着当普通词。
  const take = (pattern: RegExp, apply: (match: RegExpExecArray) => boolean): void => {
    const match = pattern.exec(rest)
    if (!match) return
    if (!apply(match)) return
    rest = `${rest.slice(0, match.index)} ${rest.slice(match.index + match[0].length)}`
  }

  const today = startOfDay(now)
  const thisMonday = mondayOf(now)

  // 上周三 / 本周五 / 这周日：必须排在“上周”“本周”前面，否则被后者先吃掉。
  // “周/星期”只在“本周星期三”这种写法里出现，所以是可选的。
  const weekday = /(上上周|上周|本周|这周)(?:[周星期])?([一二三四五六日天])/u
  take(weekday, (match) => {
    const weekStart = match[1] === '上上周' ? thisMonday - 14 * DAY_MS : match[1] === '上周' ? thisMonday - 7 * DAY_MS : thisMonday
    const label = `周${match[2] === '天' ? '日' : match[2]}`
    const offset = WEEKDAY_NAMES.indexOf(label as (typeof WEEKDAY_NAMES)[number])
    if (offset < 0) return false
    sawTimeWord = true
    // WEEKDAY_NAMES 以周日开头，转成“从周一起算”的下标
    dates.add(isoOf(weekStart + ((offset + 6) % 7) * DAY_MS))
    return true
  })

  take(/大前天/u, () => {
    sawTimeWord = true
    dates.add(isoOf(today - 3 * DAY_MS))
    return true
  })
  take(/前天/u, () => {
    sawTimeWord = true
    dates.add(isoOf(today - 2 * DAY_MS))
    return true
  })
  take(/(?:昨天|昨日)/u, () => {
    sawTimeWord = true
    dates.add(isoOf(today - DAY_MS))
    return true
  })
  take(/(?:今天|今日)/u, () => {
    sawTimeWord = true
    dates.add(isoOf(today))
    return true
  })
  take(/上上周/u, () => {
    sawTimeWord = true
    for (const date of weekDates(thisMonday - 14 * DAY_MS)) dates.add(date)
    return true
  })
  take(/上周/u, () => {
    sawTimeWord = true
    for (const date of weekDates(thisMonday - 7 * DAY_MS)) dates.add(date)
    return true
  })
  take(/(?:本周|这周)/u, () => {
    sawTimeWord = true
    for (const date of weekDates(thisMonday)) dates.add(date)
    return true
  })

  take(DATE_IN_QUERY, (match) => {
    const value = match[0]
    const time = new Date(`${value}T00:00:00`).getTime()
    if (!Number.isFinite(time)) return false
    sawTimeWord = true
    dates.add(value)
    return true
  })

  take(MONTH_DAY, (match) => {
    const month = Number(match[1])
    const day = Number(match[2])
    if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return false
    const date = new Date(new Date(now).getFullYear(), month - 1, day)
    if (date.getMonth() !== month - 1 || date.getDate() !== day) return false
    sawTimeWord = true
    dates.add(isoOf(date.getTime()))
    return true
  })

  const tokens = toHalfWidth(rest)
    .toLowerCase()
    .split(TOKEN_SPLIT)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)

  return { tokens, dates: sawTimeWord ? [...dates].sort() : null }
}

/** 主进程查询的数据入口：保留范围与逐日读取都由调用方给（逐日 rollupFor，不预热）。 */
export interface SearchSource {
  /** 保留范围内的日期（主进程传 keptDays() 的实际结果） */
  retained(): string[]
  /** 读某一天的汇总 */
  day(date: string): DayRollup
}

/** 最近 N 天（含今天），升序。 */
function recentDates(today: string): string[] {
  const [year, month, day] = today.split('-').map(Number)
  const dates: string[] = []
  for (let offset = RECENT_DAYS - 1; offset >= 0; offset -= 1) {
    dates.push(isoOf(new Date(year, month - 1, day - offset).getTime()))
  }
  return dates
}

interface Match {
  /** 真正命中的词，小写 */
  tokens: string[]
  /** 标题命中词数，仅用于排序 */
  score: number
}

/** 多词 AND：任一未命中返回 null；标题 / 原文 / 进程名任一处命中都算。 */
function matchScene(scene: Scene, tokens: readonly string[]): Match | null {
  if (tokens.length === 0) return { tokens: [], score: 0 }
  const title = normalizeTitle(scene.title).toLowerCase()
  // 归一化会去掉「- 应用名」后缀；检索仍要能搜到应用名，所以原文也参与匹配
  const raw = scene.title.toLowerCase()
  const exe = scene.exe.toLowerCase()
  const matched: string[] = []
  let score = 0
  for (const token of tokens) {
    const inTitle = title.includes(token)
    if (!inTitle && !raw.includes(token) && !exe.includes(token)) return null
    if (inTitle) score += 1
    matched.push(token)
  }
  return { tokens: matched, score }
}

interface Ranked {
  scene: Scene
  score: number
}

/** 排序（命中词数 → 开始时刻）与 200 条上限，两个入口共用。 */
function rank<T extends Ranked>(hits: T[]): T[] {
  return hits
    .sort((a, b) => b.score - a.score || b.scene.start - a.scene.start || (a.scene.id < b.scene.id ? -1 : 1))
    .slice(0, MAX_RESULTS)
}

/**
 * 纯匹配：给定日汇总与查询，返回命中镜头（不做范围对齐）。
 * `reel/index.ts` 与基准测试走这个入口；主进程的 search 通道走下面的 `searchOutcome`。
 */
export function searchScenes(query: string, days: readonly DayRollup[], now = Date.now()): Scene[] {
  const text = query.trim()
  if (text.length === 0) return []
  const { tokens, dates } = parseQuery(text, now)
  const wanted = dates === null ? null : new Set(dates)
  const hits: Ranked[] = []
  for (const day of days) {
    for (const scene of day.scenes) {
      if (wanted !== null && !wanted.has(isoOf(scene.start))) continue
      const match = matchScene(scene, tokens)
      if (match === null) continue
      hits.push({ scene, score: match.score })
    }
  }
  return rank(hits).map((hit) => hit.scene)
}

/**
 * 检索入口：有 时间词 → 解析出的日期，没有 → 最近 7 天；目标日期先与保留范围
 * （`retained()` 的下界，即 `keptDays()` 最早一天）对齐，再逐日取镜头。
 * 命中理由与匹配同一趟算出；排序、上限不变。
 */
export function searchOutcome(query: unknown, source: SearchSource, now = Date.now()): SearchOutcome {
  const retainedFrom = [...source.retained()].sort()[0] ?? null
  const text = typeof query === 'string' ? query.trim() : ''
  if (text.length === 0) return { hits: [], coverage: 'full', retainedFrom }

  const { tokens, dates } = parseQuery(text, now)
  const targets = dates ?? recentDates(isoOf(now))
  // 早于保留范围的日期已经不可能有日文件：不读盘，直接算覆盖状态
  const effective = retainedFrom === null ? targets : targets.filter((date) => date >= retainedFrom)
  const coverage: SearchCoverage =
    effective.length === 0 ? 'expired' : effective.length < targets.length ? 'partial' : 'full'

  const wanted = new Set(effective)
  const hits: (Ranked & { reason: SearchReason })[] = []
  for (const date of effective) {
    for (const scene of source.day(date).scenes) {
      const day = isoOf(scene.start)
      if (!wanted.has(day)) continue
      const match = matchScene(scene, tokens)
      if (match === null) continue
      // 只有查询里写了时间词，日期才算「真正起作用的日期」
      const reason = { tokens: match.tokens, dates: dates === null ? [] : [day] }
      hits.push({ scene, score: match.score, reason })
    }
  }

  return {
    hits: rank(hits).map((hit) => ({ scene: hit.scene, reason: hit.reason })),
    coverage,
    retainedFrom
  }
}

export { isoOf as localIsoOf }
