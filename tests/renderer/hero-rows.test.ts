// @vitest-environment jsdom
/**
 * 渲染层测试床：hero 的文案与行构建跑在 jsdom 里。
 * 这里覆盖 v4 验收报告点名的缺口：发现区条数上限、可见性、行文案、晚到请求丢弃。
 */
import { describe, expect, it, vi } from 'vitest'
import type { Discovery } from '../../src/renderer/src/lib/discover'
import type { AfterShot } from '../../src/renderer/src/lib/day-insights'
import {
  buildDiscoveryRows,
  createRequestToken,
  episodeText,
  intermissionText,
  reasonText,
  searchEmptyCopy,
  afterShotText,
  type RowDeps
} from '../../src/renderer/src/lib/hero-rows'
import type { EpisodeRef, SearchOutcome } from '../../src/shared/types'

const clock = (ms: number): string => {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const at = (hour: number, minute = 0): number => new Date(2026, 10, 26, hour, minute).getTime()

function deps(onPick = vi.fn()): RowDeps & { onPick: ReturnType<typeof vi.fn> } {
  return { clock, onPick }
}

const discovery = (kind: Discovery['kind'], text: string, start = at(9, 42)): Discovery => ({
  kind,
  text,
  evidence: [start]
})

describe('上一集文案', () => {
  const ref = (patch: Partial<EpisodeRef> = {}): EpisodeRef => ({
    date: '2026-11-24',
    start: at(14, 32),
    exe: 'Code',
    title: 'dayfilm — Visual Studio Code',
    seconds: 42 * 60 + 18,
    match: 'title',
    project: null,
    ...patch
  })

  it('三行：日期、原始标题、时刻与时长', () => {
    expect(episodeText(ref(), clock)).toBe(
      '上一集 · 11-24\ndayfilm — Visual Studio Code\n14:32 · 42 分钟'
    )
  })

  it('项目命中的那一行带项目名', () => {
    expect(episodeText(ref({ match: 'project', project: 'Dayfilm' }), clock)).toContain('14:32 · 42 分钟 · Dayfilm')
  })

  it('标题缺失时用破折号，不空行', () => {
    expect(episodeText(ref({ title: '' }), clock).split('\n')[1]).toBe('—')
  })
})

describe('中场休息文案', () => {
  const shape = (patch: Partial<Parameters<typeof intermissionText>[0]> = {}) => ({
    start: at(12, 6),
    ms: 48 * 60_000,
    outcome: 'returned' as const,
    nextExe: null,
    ...patch
  })

  it('回到原窗口', () => {
    expect(intermissionText(shape())).toBe('12:06 离开 48 分钟，回来还是同一个窗口')
  })

  it('换了窗口时点名新进程', () => {
    expect(intermissionText(shape({ outcome: 'changed', nextExe: 'Chrome' }))).toBe(
      '12:06 离开 48 分钟，回来换成了 Chrome'
    )
  })

  it('没有返回证据时不推断', () => {
    expect(intermissionText(shape({ outcome: 'unknown' }))).toBe('12:06 离开 48 分钟，还没有记录到回来')
  })

  it('不足一分钟按一分钟算', () => {
    expect(intermissionText(shape({ ms: 20_000 }))).toContain('离开 1 分钟')
  })
})

describe('镜头之后文案', () => {
  it('按组拼接次数', () => {
    const after: AfterShot = {
      endAt: at(14, 18),
      groups: [
        { name: '浏览器', count: 4 },
        { name: '终端', count: 2 }
      ]
    }
    expect(afterShotText(after, clock)).toBe('14:18 之后的 15 分钟：浏览器 × 4 · 终端 × 2')
  })
})

describe('检索文案', () => {
  it('理由：词与日期同时出现', () => {
    expect(reasonText({ tokens: ['edl'], dates: ['2026-11-19'] })).toBe('命中 edl · 日期 11-19')
  })

  it('理由：只有日期', () => {
    expect(reasonText({ tokens: [], dates: ['2026-11-19'] })).toBe('日期 11-19')
  })

  it('空状态：超出保留范围时写明边界', () => {
    const outcome: SearchOutcome = { hits: [], coverage: 'expired', retainedFrom: '2026-10-29' }
    expect(searchEmptyCopy(outcome)).toContain('2026-10-29')
  })

  it('空状态：普通空结果与 partial 都只说没找到', () => {
    expect(searchEmptyCopy({ hits: [], coverage: 'full', retainedFrom: null })).toBe('没有找到匹配的镜头')
    expect(searchEmptyCopy({ hits: [], coverage: 'partial', retainedFrom: '2026-10-29' })).toBe('没有找到匹配的镜头')
  })
})

describe('发现区（jsdom）', () => {
  it('原有的与镜头之后都没有时整块隐藏', () => {
    expect(buildDiscoveryRows(document, [], null, deps())).toBeNull()
  })

  it('只有镜头之后时也要显示一行', () => {
    const rows = buildDiscoveryRows(document, [], { endAt: at(14, 18), groups: [{ name: 'Chrome', count: 1 }] }, deps())
    expect(rows).toHaveLength(1)
    expect(rows?.[0].textContent).toContain('镜头之后')
  })

  it('三条原有发现加一条镜头之后，总数封顶四条且顺序不变', () => {
    const found = [
      discovery('return', '重返一行'),
      discovery('switch', '易位一行'),
      discovery('revisit', '反复一行')
    ]
    const rows = buildDiscoveryRows(document, found, { endAt: at(14, 18), groups: [{ name: 'Chrome', count: 2 }] }, deps())
    expect(rows).toHaveLength(4)
    expect(rows?.map((row) => row.querySelector('.discovery__label')?.textContent)).toEqual([
      '重返',
      '易位',
      '反复',
      '镜头之后'
    ])
  })

  it('点击原有发现带证据时刻，点击镜头之后带锚点结束时刻', () => {
    const spy = vi.fn()
    const rows = buildDiscoveryRows(
      document,
      [discovery('return', '重返一行', at(9, 42))],
      { endAt: at(14, 18), groups: [{ name: 'Chrome', count: 1 }] },
      { clock, onPick: spy }
    )
    rows?.[0].click()
    rows?.[1].click()
    expect(spy).toHaveBeenNthCalledWith(1, at(9, 42))
    expect(spy).toHaveBeenNthCalledWith(2, at(14, 18))
  })

  it('没有证据时刻的发现行不响应点击', () => {
    const spy = vi.fn()
    const rows = buildDiscoveryRows(document, [{ kind: 'late', text: '无证据', evidence: [] }], null, {
      clock,
      onPick: spy
    })
    rows?.[0].click()
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('晚到请求令牌', () => {
  it('只有最新令牌有效', () => {
    const token = createRequestToken()
    const first = token.next()
    const second = token.next()
    expect(token.isCurrent(first)).toBe(false)
    expect(token.isCurrent(second)).toBe(true)
  })
})
