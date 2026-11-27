/**
 * 模型通道：OpenAI 兼容端点，复用官方 `openai` SDK 的传输与重试。
 * 只在用户点按钮时调用；结果只作为候选，校验后由界面确认才落盘。
 * 这里是主进程唯一的网络出口，日志只记错误类型，不记标题与 key。
 */
import OpenAI from 'openai'
import type { AiSettings, ProjectRule } from '../../shared/settings'
import { isNoiseWord, normalizeTitle, type StoryCandidate, type StoryFailure } from '../../shared/stories'
import type { DayRollup } from '../../shared/types'

/** 请求预算：真实模型写 4 条候选要约 20–40 秒，60 秒后降级，界面保留确定性候选。 */
export const AI_TIMEOUT_MS = 60_000
/** 送给模型的标题条目上限：80 条足够认项目，prompt 短一半、延迟也短一半。 */
const DIGEST_LIMIT = 80
/** 候选名与关键词的长度上限；名字更像标签而不是句子。 */
const MAX_NAME = 16
const MAX_TERM = 32
/** 模型候选的关键词只取 1 个：多词容易把两件事拼成一条线。 */
const MAX_TERMS = 1
/** 模型候选最少要有这么多镜头与时长：太小的不算故事线。 */
const MIN_TERM_SCENES = 5
const MIN_TERM_MS = 10 * 60_000

export interface AiOutcome {
  candidates: StoryCandidate[]
  failure: StoryFailure | null
}

/** 三个字段都齐了才认为可用；apiKey 允许为空（本地服务）。 */
export function aiConfigured(settings: AiSettings | undefined): settings is AiSettings {
  if (!settings) return false
  if (!settings.enabled) return false
  if (settings.baseUrl.trim().length === 0) return false
  if (settings.model.trim().length === 0) return false
  return /^https?:\/\//i.test(settings.baseUrl.trim())
}

function clientOf(settings: AiSettings): OpenAI {
  return new OpenAI({
    apiKey: settings.apiKey.trim().length > 0 ? settings.apiKey.trim() : 'local',
    baseURL: settings.baseUrl.trim(),
    timeout: AI_TIMEOUT_MS,
    maxRetries: 0
  })
}

/** 错误 → 可展示的类型；SDK 的错误里可能带 URL 与状态码，一律不原样透出。 */
function failureOf(error: unknown): StoryFailure {
  const record = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {}
  const name = typeof record.name === 'string' ? record.name : ''
  if (name === 'AbortError' || name === 'APIConnectionTimeoutError') {
    return { kind: 'timeout', detail: `请求超过 ${Math.round(AI_TIMEOUT_MS / 1000)} 秒` }
  }
  if (name === 'APIConnectionError') return { kind: 'network', detail: '连接失败' }
  const status = typeof record.status === 'number' ? record.status : null
  if (status !== null) return { kind: 'http', detail: `接口返回 ${status}` }
  return { kind: 'network', detail: '请求失败' }
}

interface DigestEntry {
  exe: string
  title: string
  minutes: number
}

/** 只喂聚合摘要：同一窗口合并、按时长降序、最多 200 条。 */
export function buildDigest(days: readonly DayRollup[]): DigestEntry[] {
  const map = new Map<string, DigestEntry>()
  for (const day of days) {
    for (const scene of day.scenes) {
      if (scene.kind !== 'shot') continue
      const title = normalizeTitle(scene.title).slice(0, 80)
      if (title.length === 0) continue
      const key = `${scene.exe}\u0000${title}`
      const minutes = Math.round((scene.end - scene.start) / 60_000)
      const current = map.get(key)
      if (current) current.minutes += minutes
      else map.set(key, { exe: scene.exe, title, minutes })
    }
  }
  return [...map.values()]
    .sort((a, b) => b.minutes - a.minutes || (a.title < b.title ? -1 : 1))
    .slice(0, DIGEST_LIMIT)
}

/** 拼 prompt（导出供联调与单测复用；生产路径只经 suggestStoriesWithModel 调用）。 */
export function promptOf(digest: DigestEntry[], rules: readonly ProjectRule[]): string {
  const known = rules.map((rule) => rule.name).slice(0, 20)
  return [
    '你在帮我把一份「前台窗口记录」归成几个项目。只输出 JSON，不要解释。',
    'name：2–8 个字的名词短语，像给人看的项目名；不要用「与 / 和 / 、」把两件事拼起来；不要照抄标题。',
    'terms：只给 1 个词——在下面标题里原样出现过的片段，用来匹配这些窗口；不要用应用名（Chrome / Edge / Code / ChatGPT）、不要用「个人 / 工作」这类后缀、不要用纯数字。',
    '宁可少给，也不要给无法对应到标题的项。',
    '输出格式：{"stories":[{"name":"...","terms":["..."]}]}，最多 4 条。',
    known.length > 0 ? `已经存在的项目（不要重复）：${known.join('、')}` : '',
    '窗口记录：',
    JSON.stringify(digest)
  ]
    .filter((line) => line.length > 0)
    .join('\n')
}

/** 关键词是否可当匹配词：有字母或中文、不是噪声词、不是纯数字。 */
function usableTerm(term: string): boolean {
  if (term.length === 0) return false
  if (isNoiseWord(term)) return false
  if (!/[\p{L}]/u.test(term)) return false
  if (/^\p{Script=Han}+$/u.test(term)) return term.length >= 2
  return term.length >= 3
}

/** 从模型输出里取第一个 JSON 对象；失败返回 null（不抛错）。 */
export function parseStories(text: string): Array<{ name: string; terms: string[] }> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const stories = (parsed as Record<string, unknown>).stories
  if (!Array.isArray(stories)) return null

  const result: Array<{ name: string; terms: string[] }> = []
  for (const item of stories) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME) : ''
    if (name.length === 0) continue
    const rawTerms = Array.isArray(record.terms) ? record.terms : []
    const terms: string[] = []
    for (const value of rawTerms) {
      if (typeof value !== 'string') continue
      const term = value.trim().toLowerCase().slice(0, MAX_TERM)
      if (terms.includes(term) || !usableTerm(term)) continue
      terms.push(term)
      if (terms.length >= MAX_TERMS) break
    }
    if (terms.length === 0) continue
    result.push({ name, terms })
    if (result.length >= 4) break
  }
  return result
}

/**
 * 模型给的词只能用一次：命中数必须能在真实镜头里数出来。
 * 只在标题里数（不数进程名，否则 `chatgpt` 会把整个浏览器吃进去），
 * 且要求每个词都命中、命中数 ≥ MIN_TERM_SCENES；数不出来的直接丢掉。
 */
export function candidatesFrom(
  proposals: readonly { name: string; terms: string[] }[],
  days: readonly DayRollup[]
): StoryCandidate[] {
  const titles = days
    .flatMap((day) => day.scenes.filter((scene) => scene.kind === 'shot'))
    .map((scene) => ({ scene, title: normalizeTitle(scene.title).toLowerCase() }))
  const out: StoryCandidate[] = []
  const seen = new Set<string>()
  for (const proposal of proposals) {
    // 规则本身是 OR；这里只收单一关键词，多词容易把两件事拼成一条线
    const term = proposal.terms[0]
    const hits = titles.filter(({ title }) => title.includes(term))
    if (hits.length < MIN_TERM_SCENES) continue
    const ms = hits.reduce((sum, { scene }) => sum + (scene.end - scene.start), 0)
    if (ms < MIN_TERM_MS) continue
    if (seen.has(term)) continue
    seen.add(term)
    const exes = [...new Set(hits.map(({ scene }) => scene.exe))].slice(0, 4)
    out.push({
      name: proposal.name.length > 0 ? proposal.name : term,
      term,
      scenes: hits.length,
      ms,
      exes,
      example: normalizeTitle(hits[0].scene.title).slice(0, 120),
      source: 'model'
    })
  }
  return out
}

/** 让模型补充故事线候选；任何失败都返回 failure，由调用方保留确定性候选。 */
export async function suggestStoriesWithModel(
  settings: AiSettings,
  days: readonly DayRollup[],
  rules: readonly ProjectRule[]
): Promise<AiOutcome> {
  if (!aiConfigured(settings)) {
    return { candidates: [], failure: { kind: 'not-configured', detail: '模型通道未配置' } }
  }
  const digest = buildDigest(days)
  if (digest.length === 0) return { candidates: [], failure: null }

  try {
    const completion = await clientOf(settings).chat.completions.create({
      model: settings.model.trim(),
      temperature: 0.2,
      messages: [
        { role: 'system', content: '你只输出 JSON，不输出解释。' },
        { role: 'user', content: promptOf(digest, rules) }
      ]
    })
    const text = completion.choices?.[0]?.message?.content ?? ''
    const parsed = parseStories(typeof text === 'string' ? text : '')
    if (parsed === null) return { candidates: [], failure: { kind: 'format', detail: '模型返回格式不符' } }
    return { candidates: candidatesFrom(parsed, days), failure: null }
  } catch (error) {
    return { candidates: [], failure: failureOf(error) }
  }
}

/** 设置页的"测试连接"：发一句最小请求，验证基址、key 与模型名。 */
export async function probeModel(settings: AiSettings): Promise<{ ok: boolean; detail: string }> {
  if (!aiConfigured(settings)) return { ok: false, detail: '模型通道未配置' }
  try {
    await clientOf(settings).chat.completions.create({
      model: settings.model.trim(),
      max_tokens: 4,
      messages: [{ role: 'user', content: 'ping' }]
    })
    return { ok: true, detail: '连接正常' }
  } catch (error) {
    const failure = failureOf(error)
    return { ok: false, detail: failure.detail }
  }
}
