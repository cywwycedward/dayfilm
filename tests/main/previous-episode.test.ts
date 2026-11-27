import { describe, expect, it } from 'vitest'
import { lastEpisodeOf, previousEpisode, type EpisodeSource } from '../../src/main/reel/previous-episode'
import type { ProjectRule } from '../../src/shared/settings'
import type { DayRollup, Scene } from '../../src/shared/types'

const MINUTE = 60_000

function shot(date: string, hour: number, minutes: number, exe: string, title: string, id: string): Scene {
  const [year, month, day] = date.split('-').map(Number)
  const start = new Date(year, month - 1, day, hour).getTime()
  return { id, start, end: start + minutes * MINUTE, exe, title, seconds: minutes * 60, kind: 'shot' }
}

function dayOf(date: string, scenes: Scene[], longest: Scene | null = scenes[0] ?? null): DayRollup {
  const activeMs = scenes.reduce((sum, scene) => sum + (scene.end - scene.start), 0)
  return {
    date,
    firstAt: scenes[0]?.start ?? null,
    lastAt: scenes.length > 0 ? scenes[scenes.length - 1].end : null,
    activeMs,
    idleMs: 0,
    scenes,
    cuts: Math.max(0, scenes.length - 1),
    longestShot: longest,
    topApps: [],
    verdict: { label: '标准剪辑', note: '', cutRate: 0 },
    featureMs: activeMs,
    extraMs: 0
  }
}

/** 假的读取入口：保留范围与日汇总都由测试给。 */
function sourceOf(days: DayRollup[], retained: string[], projects: ProjectRule[] = []): EpisodeSource {
  const byDate = new Map(days.map((day) => [day.date, day]))
  return {
    retained: () => retained,
    day: (date) => byDate.get(date) ?? dayOf(date, [], null),
    projects: () => projects
  }
}

const RULES: ProjectRule[] = [
  { name: '设计', terms: ['figma'] },
  { name: 'Dayfilm', terms: ['code'] }
]

describe('previousEpisode', () => {
  const anchorDay = dayOf('2026-11-20', [shot('2026-11-20', 9, 40, 'Code', 'report.ts - Code', 'anchor')])

  it('只看严格早于所查看日期的日子：同标题也不许命中更晚的一天', () => {
    const laterDay = dayOf('2026-11-21', [shot('2026-11-21', 9, 40, 'Code', 'report.ts - Code', 'later')])
    const source = sourceOf([anchorDay, laterDay], ['2026-11-20', '2026-11-21'], RULES)
    expect(previousEpisode('2026-11-20', source)).toBeNull()
  })

  it('从近到远，命中第一天就停', () => {
    const near = dayOf('2026-11-19', [shot('2026-11-19', 14, 30, 'Code', 'report.ts - Code', 'near')])
    const far = dayOf('2026-11-18', [shot('2026-11-18', 14, 30, 'Code', 'report.ts - Code', 'far')])
    // retained 故意乱序：范围与顺序由函数自己排
    const source = sourceOf([anchorDay, near, far], ['2026-11-18', '2026-11-20', '2026-11-19'], RULES)
    const ref = previousEpisode('2026-11-20', source)
    expect(ref).toMatchObject({ date: '2026-11-19', start: near.scenes[0].start, match: 'title', project: 'Dayfilm' })
  })

  it('同一天多条命中取最后一条', () => {
    const morning = shot('2026-11-19', 9, 30, 'Code', 'report.ts - Code', 'm')
    const evening = shot('2026-11-19', 20, 10, 'Code', 'report.ts - Code', 'e')
    const day = dayOf('2026-11-19', [morning, evening, shot('2026-11-19', 21, 0, 'Figma', '设计稿', 'other')])
    expect(lastEpisodeOf(anchorDay.scenes[0], day, RULES)?.start).toBe(evening.start)
  })

  it('同名不同项目不命中（原始标题要完全相同，不做模糊匹配）', () => {
    // 两边标题都含 report.ts，但不是同一份原文、也不属于同一个项目
    const other = dayOf('2026-11-19', [shot('2026-11-19', 10, 0, 'Figma', 'report.ts 设计稿 - Figma', 'o')])
    const source = sourceOf([anchorDay, other], ['2026-11-20', '2026-11-19'], RULES)
    expect(previousEpisode('2026-11-20', source)).toBeNull()
  })

  it('同一项目不同窗口命中，并带上项目名', () => {
    const sameProject = dayOf('2026-11-19', [shot('2026-11-19', 10, 0, 'Code', 'notes.md - Code', 'p')])
    const source = sourceOf([anchorDay, sameProject], ['2026-11-20', '2026-11-19'], RULES)
    expect(previousEpisode('2026-11-20', source)).toMatchObject({ match: 'project', project: 'Dayfilm' })
  })

  it('当天没有镜头（没有锚点）返回 null', () => {
    const empty = dayOf('2026-11-20', [], null)
    const earlier = dayOf('2026-11-19', [shot('2026-11-19', 10, 0, 'Code', 'report.ts - Code', 'x')])
    const source = sourceOf([empty, earlier], ['2026-11-20', '2026-11-19'], RULES)
    expect(previousEpisode('2026-11-20', source)).toBeNull()
  })

  it('都没有命中时返回 null', () => {
    const unrelated = dayOf('2026-11-19', [shot('2026-11-19', 10, 0, 'WeChat', '微信', 'u')])
    const source = sourceOf([anchorDay, unrelated], ['2026-11-20', '2026-11-19'], RULES)
    expect(previousEpisode('2026-11-20', source)).toBeNull()
  })
})
