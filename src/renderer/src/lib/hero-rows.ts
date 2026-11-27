/**
 * hero 与检索里的文案 + 行构建。文案是纯函数，行构建只依赖传入的 `document`，
 * 所以渲染层终于有一套能跑在 jsdom 下的测试床（`tests/renderer/hero-rows.test.ts`）。
 */
import type { Discovery } from './discover'
import type { AfterShot, IntermissionShape } from './day-insights'
import type { EpisodeRef, SearchOutcome, SearchReason } from '../../../shared/types'

export const DISCOVERY_LABEL: Record<Discovery['kind'], string> = {
  return: '重返',
  switch: '易位',
  revisit: '反复',
  late: '深夜'
}

export interface RowDeps {
  /** 毫秒 → 本地 `HH:MM` */
  clock(ms: number): string
  /** 点击某一行时回调该行的证据时刻 */
  onPick(startMs: number): void
}

/** 上一集三行文案：`上一集 · MM-DD` / 原始标题 / `HH:MM · N 分钟`。 */
export function episodeText(ref: EpisodeRef, clock: (ms: number) => string): string {
  const project = ref.match === 'project' && ref.project !== null ? ` · ${ref.project}` : ''
  const minutes = Math.max(1, Math.round(ref.seconds / 60))
  return `上一集 · ${ref.date.slice(5)}\n${ref.title || '—'}\n${clock(ref.start)} · ${minutes} 分钟${project}`
}

/** 中场休息一行：几点走、多久、回来是不是同一个窗口。 */
export function intermissionText(shape: IntermissionShape): string {
  const minutes = Math.max(1, Math.round(shape.ms / 60_000))
  const head = `${String(new Date(shape.start).getHours()).padStart(2, '0')}:${String(new Date(shape.start).getMinutes()).padStart(2, '0')} 离开 ${minutes} 分钟`
  if (shape.outcome === 'returned') return `${head}，回来还是同一个窗口`
  if (shape.outcome === 'changed') return `${head}，回来换成了 ${shape.nextExe ?? '另一个窗口'}`
  return `${head}，还没有记录到回来`
}

/** 镜头之后 15 分钟：`14:18 之后的 15 分钟：浏览器 × 4 · 终端 × 2`。 */
export function afterShotText(after: AfterShot, clock: (ms: number) => string): string {
  const summary = after.groups.map((group) => `${group.name} × ${group.count}`).join(' · ')
  return `${clock(after.endAt)} 之后的 15 分钟：${summary}`
}

/** 命中理由一行：`命中 edl · 日期 11-19`；只有其中一项时只写那一项。 */
export function reasonText(reason: SearchReason): string {
  const parts: string[] = []
  if (reason.tokens.length > 0) parts.push(`命中 ${reason.tokens.join(' ')}`)
  if (reason.dates.length > 0) parts.push(`日期 ${reason.dates.map((date) => date.slice(5)).join(' ')}`)
  return parts.join(' · ')
}

/** 检索空状态的两种文案：日期超出保留范围 vs 普通没有命中。 */
export function searchEmptyCopy(outcome: SearchOutcome): string {
  if (outcome.coverage === 'expired' && outcome.retainedFrom !== null) {
    return `所选日期已超出保留范围；当前仅保留 ${outcome.retainedFrom} 及之后的记录`
  }
  return '没有找到匹配的镜头'
}

function button(doc: Document, className: string, label: string, text: string): HTMLButtonElement {
  const row = doc.createElement('button')
  row.type = 'button'
  row.className = className
  const tag = doc.createElement('span')
  tag.className = 'discovery__label'
  tag.textContent = label
  const body = doc.createElement('span')
  body.className = 'discovery__text'
  body.textContent = text
  row.append(tag, body)
  return row
}

/** 原有发现一行；有证据镜头时整行可点。 */
export function buildDiscoveryRow(doc: Document, item: Discovery, deps: RowDeps): HTMLButtonElement {
  const row = button(doc, 'discovery', DISCOVERY_LABEL[item.kind], item.text)
  const at = item.evidence[0]
  if (at !== undefined) row.addEventListener('click', () => deps.onPick(at))
  return row
}

/** 「镜头之后」一行；点击回到那 15 分钟里的第一个镜头（由调用方解析）。 */
export function buildAfterShotRow(doc: Document, after: AfterShot, deps: RowDeps): HTMLButtonElement {
  const row = button(doc, 'discovery', '镜头之后', afterShotText(after, deps.clock))
  row.addEventListener('click', () => deps.onPick(after.endAt))
  return row
}

/**
 * hero 的发现区：原有发现最多三行，末尾固定追加一行「镜头之后」，总共最多四条。
 * 两者都没有时返回 `null`，调用方整块隐藏。
 */
export function buildDiscoveryRows(
  doc: Document,
  found: readonly Discovery[],
  after: AfterShot | null,
  deps: RowDeps
): HTMLElement[] | null {
  if (found.length === 0 && after === null) return null
  const rows: HTMLElement[] = found.map((item) => buildDiscoveryRow(doc, item, deps))
  if (after !== null) rows.push(buildAfterShotRow(doc, after, deps))
  return rows
}

export interface RequestToken {
  /** 开一次新请求，返回它的令牌 */
  next(): number
  /** 该令牌是否仍是最新的（晚到的旧响应返回 false） */
  isCurrent(token: number): boolean
}

/** 快速切日/改查询时丢弃晚到响应的令牌。 */
export function createRequestToken(): RequestToken {
  let current = 0
  return {
    next(): number {
      current += 1
      return current
    },
    isCurrent(token: number): boolean {
      return token === current
    }
  }
}
