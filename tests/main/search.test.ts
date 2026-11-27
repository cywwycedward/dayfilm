import { describe, expect, it } from 'vitest'
import { parseQuery, searchOutcome, searchScenes, type SearchSource } from '../../src/main/reel/search'
import type { DayRollup, Scene } from '../../src/shared/types'

const MINUTE = 60_000
const NOW = new Date(2026, 10, 25, 15, 0, 0, 0).getTime() // 2026-11-25 周三

function sceneAt(start: number, minutes: number, exe: string, title: string, id: string): Scene {
  return {
    id,
    start,
    end: start + minutes * MINUTE,
    exe,
    title,
    seconds: minutes * 60,
    kind: 'shot'
  }
}

function dayOf(date: string, scenes: Scene[]): DayRollup {
  const ms = scenes.reduce((sum, item) => sum + (item.end - item.start), 0)
  return {
    date,
    firstAt: scenes[0]?.start ?? null,
    lastAt: scenes[scenes.length - 1]?.end ?? null,
    activeMs: ms,
    idleMs: 0,
    scenes,
    cuts: Math.max(0, scenes.length - 1),
    longestShot: null,
    topApps: [],
    verdict: { label: '标准剪辑', note: '', cutRate: 0 },
    featureMs: ms,
    extraMs: 0
  }
}

function localMs(date: string, hour: number): number {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day, hour).getTime()
}

describe('parseQuery', () => {
  it('昨天 / 前天 / 今天解析成单个日期', () => {
    expect(parseQuery('昨天', NOW).dates).toEqual(['2026-11-24'])
    expect(parseQuery('前天', NOW).dates).toEqual(['2026-11-23'])
    expect(parseQuery('今天', NOW).dates).toEqual(['2026-11-25'])
  })

  it('上周三解析成上周的周三，并把时间词从查询里剥离', () => {
    const parsed = parseQuery('上周三 pdf', NOW)
    expect(parsed.dates).toEqual(['2026-11-18'])
    expect(parsed.tokens).toEqual(['pdf'])
  })

  it('本周取周一到周日', () => {
    const parsed = parseQuery('本周', NOW)
    expect(parsed.dates).toEqual([
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
      '2026-11-29'
    ])
  })

  it('YYYY-MM-DD 与 M月D日', () => {
    expect(parseQuery('2026-11-19', NOW).dates).toEqual(['2026-11-19'])
    expect(parseQuery('11月19日', NOW).dates).toEqual(['2026-11-19'])
  })

  it('不存在的日期当普通词', () => {
    const parsed = parseQuery('2月30日 报表', NOW)
    expect(parsed.dates).toBeNull()
    expect(parsed.tokens).toContain('2月30日')
    expect(parsed.tokens).toContain('报表')
  })
})

describe('searchScenes', () => {
  const day1 = dayOf('2026-11-25', [
    sceneAt(localMs('2026-11-25', 9), 30, 'Code', 'dayfilm - Visual Studio Code', 'a'),
    sceneAt(localMs('2026-11-25', 11), 20, 'msedge', 'dayfilm 设计稿 · Figma', 'b'),
    sceneAt(localMs('2026-11-25', 14), 10, 'Code', 'report.ts - dayfilm - Visual Studio Code', 'c')
  ])
  const day2 = dayOf('2026-11-18', [
    sceneAt(localMs('2026-11-18', 10), 25, 'msedge', '季度报表.pdf - 浏览器', 'd')
  ])

  it('空查询返回空数组', () => {
    expect(searchScenes('', [day1, day2])).toEqual([])
    expect(searchScenes('   ', [day1, day2])).toEqual([])
  })

  it('多词 AND：两个词都得命中', () => {
    const hits = searchScenes('dayfilm pdf', [day1, day2], NOW)
    expect(hits).toEqual([])
    const both = searchScenes('dayfilm report', [day1, day2], NOW)
    expect(both.map((scene) => scene.title)).toContain('report.ts - dayfilm - Visual Studio Code')
  })

  it('时间词把范围收到那一天', () => {
    const hits = searchScenes('上周 PDF', [day1, day2], NOW)
    expect(hits.map((scene) => scene.id)).toEqual(['d'])
  })

  it('只输入时间词时返回那一天的全部镜头', () => {
    const hits = searchScenes('上周三', [day1, day2], NOW)
    expect(hits.map((scene) => scene.id)).toEqual(['d'])
  })

  it('进程名也能命中', () => {
    const hits = searchScenes('msedge', [day1, day2], NOW)
    expect(hits.map((scene) => scene.id).sort()).toEqual(['b', 'd'])
  })

  it('标题命中数多的排在前面，同分按时间倒序', () => {
    const hits = searchScenes('dayfilm', [day1, day2], NOW)
    expect(hits.map((scene) => scene.id)).toEqual(['c', 'b', 'a'])
  })

  it('归一化后大小写与全角不影响命中', () => {
    const hits = searchScenes('ＤＡＹＦＩＬＭ', [day1, day2], NOW)
    expect(hits.length).toBe(3)
  })
})

/** 假的读取入口：保留范围与日汇总都由测试给。 */
function sourceOf(days: DayRollup[], retained = days.map((day) => day.date)): SearchSource {
  const byDate = new Map(days.map((day) => [day.date, day]))
  return { retained: () => retained, day: (date) => byDate.get(date) ?? dayOf(date, []) }
}

describe('searchOutcome', () => {
  const today = dayOf('2026-11-25', [
    sceneAt(localMs('2026-11-25', 9), 30, 'Code', 'dayfilm - Visual Studio Code', 'a'),
    sceneAt(localMs('2026-11-25', 11), 20, 'msedge', 'dayfilm 设计稿 · Figma', 'b'),
    sceneAt(localMs('2026-11-25', 14), 10, 'Code', 'report.ts - dayfilm - Visual Studio Code', 'c')
  ])
  // 正好在 7 天窗口内的第一天（11-25 减 6）与窗口外一天
  const seventh = dayOf('2026-11-19', [sceneAt(localMs('2026-11-19', 10), 25, 'msedge', 'dayfilm 周报', 'e')])
  const outside = dayOf('2026-11-18', [sceneAt(localMs('2026-11-18', 10), 25, 'msedge', '季度报表.pdf - 浏览器', 'd')])

  it('没有时间词时查最近 7 天（含今天）', () => {
    const outcome = searchOutcome('dayfilm', sourceOf([today, seventh, outside]), NOW)
    expect(outcome.hits.map((hit) => hit.scene.id)).toEqual(['c', 'b', 'a', 'e'])
    expect(outcome.coverage).toBe('full')
    // 只有查词时没有日期参与，理由里的 dates 为空
    expect(outcome.hits[0].reason).toEqual({ tokens: ['dayfilm'], dates: [] })
  })

  it('有时间词时只查解析出的日期，并把日期写进理由', () => {
    const outcome = searchOutcome('上周 PDF', sourceOf([today, outside]), NOW)
    expect(outcome.hits.map((hit) => hit.scene.id)).toEqual(['d'])
    expect(outcome.hits[0].reason).toEqual({ tokens: ['pdf'], dates: ['2026-11-18'] })
  })

  it('多词仍为 AND，理由里只留真正命中的词', () => {
    expect(searchOutcome('dayfilm pdf', sourceOf([today, outside]), NOW).hits).toEqual([])
    const outcome = searchOutcome('DAYFILM report', sourceOf([today, outside]), NOW)
    expect(outcome.hits.map((hit) => hit.scene.id)).toEqual(['c'])
    expect(outcome.hits[0].reason).toEqual({ tokens: ['dayfilm', 'report'], dates: [] })
  })

  it('进程名命中同样进理由', () => {
    const outcome = searchOutcome('msedge 2026-11-18', sourceOf([today, outside]), NOW)
    expect(outcome.hits.map((hit) => hit.scene.id)).toEqual(['d'])
    expect(outcome.hits[0].reason).toEqual({ tokens: ['msedge'], dates: ['2026-11-18'] })
  })

  it('只有日期没有词：返回那天的全部镜头，tokens 为空', () => {
    const outcome = searchOutcome('上周三', sourceOf([today, outside]), NOW)
    expect(outcome.hits.map((hit) => hit.scene.id)).toEqual(['d'])
    expect(outcome.hits[0].reason).toEqual({ tokens: [], dates: ['2026-11-18'] })
  })

  it('空查询：空 hits 且 coverage 为 full，仍报出 retainedFrom', () => {
    expect(searchOutcome('   ', sourceOf([today, outside]))).toEqual({
      hits: [],
      coverage: 'full',
      retainedFrom: '2026-11-18'
    })
    expect(searchOutcome(undefined, sourceOf([today, outside]))).toEqual({
      hits: [],
      coverage: 'full',
      retainedFrom: '2026-11-18'
    })
  })

  it('目标日期全早于保留范围是 expired，部分早于是 partial', () => {
    const expired = searchOutcome('2026-11-17', sourceOf([today, outside], ['2026-11-18', '2026-11-25']), NOW)
    expect(expired.coverage).toBe('expired')
    expect(expired.hits).toEqual([])

    const partial = searchOutcome('本周 dayfilm', sourceOf([today], ['2026-11-25']), NOW)
    expect(partial.coverage).toBe('partial')
    expect(partial.hits.map((hit) => hit.scene.id)).toEqual(['c', 'b', 'a'])
  })
})
