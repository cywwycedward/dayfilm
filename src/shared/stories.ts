/**
 * 故事线候选：从窗口标题里抽出可验证的名词，聚成"这条线出现了几次"。
 * 纯函数、无模型、无网络：同一份数据永远得到同一份候选（顺序、文案都一样）。
 */
import type { ProjectRule } from './settings'
import type { DayRollup, Scene } from './types'

export interface StoryCandidate {
  /** 写进规则的关键词，也是默认规则名 */
  name: string
  term: string
  /** 命中的镜头数 */
  scenes: number
  /** 累计时长（毫秒） */
  ms: number
  /** 命中过的进程名，去重后最多 4 个 */
  exes: string[]
  /** 一条命中标题的归一化原文，用作证据 */
  example: string
  /** 候选来源：确定性抽取，或用户点按钮后由模型补充 */
  source: 'template' | 'model'
}

/** 模型通道的失败类型：可安全展示，不含 key 与标题。`read` 是本地读盘失败。 */
export interface StoryFailure {
  kind: 'not-configured' | 'timeout' | 'network' | 'http' | 'format' | 'read'
  detail: string
}

/** 故事线候选的返回体：失败时仍带确定性候选，界面不做阻塞提示。 */
export interface StorySuggestions {
  candidates: StoryCandidate[]
  failure: StoryFailure | null
}

/** 有候选意义的最小镜头数与时长（规格 S1.2 第 3 条）。 */
export const CANDIDATE_MIN_SCENES = 5
export const CANDIDATE_MIN_MS = 10 * 60_000
/** 候选上限（规格 S1.2 第 6 条）。 */
export const CANDIDATE_LIMIT = 8

/** 常见噪声词：文件名主干、扩展名、平台名、浏览器配置名。 */
const NOISE_WORDS: ReadonlySet<string> = new Set([
  'index',
  'readme',
  'main',
  'test',
  'spec',
  'src',
  'dist',
  'build',
  'node_modules',
  'github',
  'gitlab',
  'the',
  'and',
  'for',
  'with',
  'from',
  'this',
  'that',
  'http',
  'https',
  'www',
  'com',
  'html',
  'json',
  'yaml',
  'toml',
  'css',
  'png',
  'svg',
  'docx',
  'xlsx',
  'pptx',
  'txt',
  'csv',
  'pdf',
  'md',
  // Edge/Chrome 的窗口标题常以配置名结尾（`… - 个人`），它不是项目名
  '个人',
  '工作',
  '默认',
  'profile',
  'default',
  'untitled',
  '无标题',
  '新标签页',
  '新通知',
  'microsoft',
  'windows'
])

/** 一个词是否属于噪声（模型候选也用它把关）。 */
export function isNoiseWord(token: string): boolean {
  return NOISE_WORDS.has(token.trim().toLowerCase())
}

const APP_SUFFIX = /\s+[-–—|·]\s+[^-–—|·]{1,60}$/
const PAGE_SUFFIX = /\s*和另外\s*\d+\s*个页面\s*$/
const UNREAD_PREFIX = /^\s*[（(]\d+[)）]\s*/
const INLINE_UNREAD = /[（(]\d+[)）]/g
const DRIVE_PREFIX = /^(?:[A-Za-z]:\\|\\\\|[^\s]*)(?:[^\s\\]+\\)+/u
const DIRTY_MARKS = /[*•]/g

/** 全角字符折成半角，中文标题里混着全角括号和全角空格是常态。 */
export function toHalfWidth(value: string): string {
  return value
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
}

/**
 * 标题归一化：只用于抽取与检索召回，**不改写落盘原文**。
 * 依次去掉「- 应用名」与「和另外 N 个页面」后缀、盘符前缀、未读计数与脏标记，最后折叠空白。
 */
export function normalizeTitle(title: string): string {
  let text = toHalfWidth(title).trim()
  // 脏标记（* / •）可能挡在盘符或前缀前面，先剥掉再处理后面的前缀
  text = text.replace(DIRTY_MARKS, '')
  text = text.replace(APP_SUFFIX, '')
  text = text.replace(PAGE_SUFFIX, '')
  text = text.replace(DRIVE_PREFIX, '')
  text = text.replace(UNREAD_PREFIX, '')
  text = text.replace(INLINE_UNREAD, '')
  return text.replace(/\s+/g, ' ').trim()
}

const TOKEN_SPLIT = /[^\p{L}\p{N}._#-]+/gu
const ISSUE_KEY = /^([\p{L}][\p{L}\p{N}]{1,9})-\d{2,5}$/u
const LATIN_WORD = /^[\p{Script=Latin}\p{N}_-]+$/u

/** 中文词至少 2 字、拉丁词至少 3 字（规格 S1.2 第 2 条）。 */
function keepToken(token: string): boolean {
  if (token.length === 0) return false
  if (/^\p{Script=Han}+$/u.test(token)) return token.length >= 2 && token.length <= 6
  if (!LATIN_WORD.test(token)) return false
  return token.length >= 3
}

/**
 * 从一条窗口标题里抽实体词（小写、去重）。
 * 文件名取主干（`login.spec.ts` → `login`），issue 号取前缀（`DF-412` → `df`）。
 */
export function extractEntities(title: string, exe = ''): string[] {
  const normalized = normalizeTitle(title).toLowerCase()
  if (normalized.length === 0) return []
  const excluded = exe.trim().toLowerCase()
  const seen = new Set<string>()
  const entities: string[] = []
  const push = (value: string): void => {
    const token = value.replace(/^[._#-]+|[._#-]+$/g, '')
    if (!keepToken(token)) return
    if (token === excluded) return
    if (NOISE_WORDS.has(token)) return
    if (seen.has(token)) return
    seen.add(token)
    entities.push(token)
  }

  for (const raw of normalized.split(TOKEN_SPLIT)) {
    const token = raw.replace(/^[._#-]+|[._#-]+$/g, '')
    if (token.length === 0) continue
    const issue = ISSUE_KEY.exec(token)
    if (issue) {
      // issue 前缀常常只有 2 个字母（DF / UI / BE），不受“拉丁词 ≥3 字”的限制
      const prefix = issue[1]
      if (prefix === excluded || NOISE_WORDS.has(prefix) || seen.has(prefix)) continue
      seen.add(prefix)
      entities.push(prefix)
      continue
    }
    if (token.includes('.')) {
      // `login.spec.ts` / `layer.py`：只取主干，扩展名是噪声
      push(token.split('.')[0] ?? '')
      continue
    }
    push(token)
  }
  return entities
}

interface Tally {
  scenes: number
  ms: number
  dates: Set<string>
  exes: Set<string>
  example: string
  firstStart: number
}

function tallyOf(day: DayRollup, tally: Map<string, Tally>): void {
  for (const scene of day.scenes) {
    if (scene.kind !== 'shot') continue
    const ms = scene.end - scene.start
    for (const entity of extractEntities(scene.title, scene.exe)) {
      const current = tally.get(entity)
      if (current) {
        current.scenes += 1
        current.ms += ms
        current.dates.add(day.date)
        current.exes.add(scene.exe)
        if (scene.start < current.firstStart) {
          current.firstStart = scene.start
          current.example = normalizeTitle(scene.title)
        }
        continue
      }
      tally.set(entity, {
        scenes: 1,
        ms,
        dates: new Set([day.date]),
        exes: new Set([scene.exe]),
        example: normalizeTitle(scene.title),
        firstStart: scene.start
      })
    }
  }
}

/** 规则关键词已覆盖（含互相包含）的实体不再重复建议。 */
function covered(entity: string, rules: readonly ProjectRule[]): boolean {
  for (const rule of rules) {
    if (rule.name.trim().toLowerCase() === entity) return true
    for (const term of rule.terms) {
      const needle = term.trim().toLowerCase()
      if (needle.length === 0) continue
      if (entity.includes(needle) || needle.includes(entity)) return true
    }
  }
  return false
}

/**
 * 候选：命中 ≥5 个镜头且 ≥10 分钟，且跨 ≥2 天或 ≥3 个进程；
 * 互为子串的一对只留命中更多的一方（并列时留更长的那一个）。
 */
export function storyCandidates(
  days: readonly DayRollup[],
  rules: readonly ProjectRule[] = [],
  limit = CANDIDATE_LIMIT
): StoryCandidate[] {
  const tally = new Map<string, Tally>()
  for (const day of days) tallyOf(day, tally)

  const raw: StoryCandidate[] = []
  for (const [term, value] of tally) {
    if (value.scenes < CANDIDATE_MIN_SCENES) continue
    if (value.ms < CANDIDATE_MIN_MS) continue
    if (value.dates.size < 2 && value.exes.size < 3) continue
    if (covered(term, rules)) continue
    raw.push({
      name: term,
      term,
      scenes: value.scenes,
      ms: value.ms,
      exes: [...value.exes].slice(0, 4),
      example: value.example.slice(0, 120),
      source: 'template'
    })
  }

  raw.sort((a, b) => b.scenes - a.scenes || b.ms - a.ms || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
  const kept: StoryCandidate[] = []
  for (const candidate of raw) {
    const clash = kept.some(
      (existing) =>
        existing.term.includes(candidate.term) ||
        candidate.term.includes(existing.term)
    )
    if (clash) continue
    kept.push(candidate)
    if (kept.length >= Math.max(1, limit)) break
  }
  return kept
}

/** 一个镜头的展示标题：归一化后的原文，空标题回落到进程名。 */
export function sceneLabel(scene: Pick<Scene, 'title' | 'exe'>): string {
  const title = normalizeTitle(scene.title)
  return title.length > 0 ? title : scene.exe
}
