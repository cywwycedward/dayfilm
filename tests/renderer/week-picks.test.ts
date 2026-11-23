import { describe, expect, test } from 'vitest'
import type { ProjectRule } from '../../src/shared/settings'
import type { DayRollup, Scene } from '../../src/shared/types'
import { buildWeekFilm, pickWeekHighlights, weekDates, type WeekDay } from '../../src/renderer/src/lib/week-film'
import { startOfDay } from '../../src/renderer/src/lib/time'

const HOUR = 3_600_000
const MINUTE = 60_000

const PROJECTS: ProjectRule[] = [
  { name: 'Dayfilm', terms: ['dayfilm'] },
  { name: '阅读', terms: ['mdn'] },
  { name: '写作', terms: ['notion'] }
]

function scene(id: string, date: string, hour: number, minutes: number, exe: string, title: string): Scene {
  const start = startOfDay(date) + hour * HOUR
  return { id, start, end: start + minutes * MINUTE, exe, title, seconds: minutes * 60, kind: 'shot' }
}

function rollup(date: string, scenes: Scene[], cuts = 0): DayRollup {
  return {
    date,
    firstAt: scenes[0]?.start ?? null,
    lastAt: scenes[scenes.length - 1]?.end ?? null,
    activeMs: scenes.reduce((sum, item) => sum + (item.end - item.start), 0),
    featureMs: scenes.reduce((sum, item) => sum + (item.end - item.start), 0),
    extraMs: 0,
    idleMs: 0,
    scenes,
    cuts,
    longestShot: scenes.reduce<Scene | null>((best, item) => (!best || item.seconds > best.seconds ? item : best), null),
    topApps: [],
    verdict: { label: '标准剪辑', note: '', cutRate: 0 }
  }
}

function week(scenesByDay: Record<number, Scene[]>, cutsByDay: Record<number, number> = {}): WeekDay[] {
  return weekDates('2025-01-13').map((date, index) => ({
    date,
    day: scenesByDay[index] ? rollup(date, scenesByDay[index], cutsByDay[index] ?? 0) : null
  }))
}

describe('pickWeekHighlights', () => {
  test('空周没有精选', () => {
    const film = buildWeekFilm({ days: week({}), projects: PROJECTS, today: '2025-01-19' })
    expect(pickWeekHighlights(film, PROJECTS)).toEqual([])
  })

  test('首项是本周最长镜头，末项是最后一镜', () => {
    const dates = weekDates('2025-01-13')
    const film = buildWeekFilm({
      days: week({
        0: [scene('a', dates[0], 9, 30, 'Code', 'dayfilm - VS Code'), scene('b', dates[0], 11, 120, 'Code', 'dayfilm notes')],
        2: [scene('c', dates[2], 9, 40, 'chrome', 'MDN — Canvas')],
        4: [scene('d', dates[4], 10, 20, 'Notion', 'notion page')],
        6: [scene('e', dates[6], 10, 15, 'slack', 'slack channel')]
      }),
      projects: PROJECTS,
      today: dates[6]
    })
    const picks = pickWeekHighlights(film, PROJECTS)
    expect(picks[0].reason).toBe('本周最长镜头')
    expect(picks[0].scene.id).toBe('b')
    expect(picks[picks.length - 1].reason).toBe('本周最后一镜')
    expect(picks[picks.length - 1].scene.id).toBe('e')
  })

  test('按 date + start 去重', () => {
    const dates = weekDates('2025-01-13')
    // 只有一天、只有一个镜头：最长 / 最密 / 项目登场 / 最后一镜都指向它
    const film = buildWeekFilm({
      days: week({ 0: [scene('only', dates[0], 9, 45, 'Code', 'dayfilm - VS Code')] }),
      projects: PROJECTS,
      today: dates[6]
    })
    const picks = pickWeekHighlights(film, PROJECTS)
    expect(picks).toHaveLength(1)
    expect(picks[0].reason).toBe('本周最长镜头')
  })

  test('每个故事线取本周第一次登场', () => {
    const dates = weekDates('2025-01-13')
    const film = buildWeekFilm({
      days: week({
        // 阅读 / 写作 先以短镜头登场；最密窗口用两个不归属项目的小镜头占掉
        1: [scene('a1', dates[1], 9, 10, 'chrome', 'MDN — Canvas'), scene('a2', dates[1], 10, 20, 'Notion', 'notion page')],
        2: [scene('s1', dates[2], 9, 5, 'slack', 'slack channel'), scene('s2', dates[2], 9.17, 5, 'slack', 'slack other')],
        3: [scene('b1', dates[3], 9, 30, 'Code', 'dayfilm - VS Code'), scene('b2', dates[3], 11, 40, 'chrome', 'MDN — CSS')]
      }),
      projects: PROJECTS,
      today: dates[6]
    })
    const picks = pickWeekHighlights(film, PROJECTS)
    const reasons = picks.map((pick) => pick.reason)
    expect(reasons).toContain('Dayfilm 本周登场')
    expect(reasons).toContain('阅读 本周登场')
    const dayfilmPick = picks.find((pick) => pick.reason === 'Dayfilm 本周登场')
    expect(dayfilmPick?.scene.id).toBe('b1')
    const readingPick = picks.find((pick) => pick.reason === '阅读 本周登场')
    expect(readingPick?.scene.id).toBe('a1')
  })

  test('换戏当天的第一个镜头入选（不与登场重复）', () => {
    const dates = weekDates('2025-01-13')
    // 阅读周一就以短镜头登场，周三换戏到阅读时第一镜另外算一条
    const days: WeekDay[] = [
      {
        date: dates[0],
        day: rollup(
          dates[0],
          [scene('d0', dates[0], 9, 120, 'Code', 'dayfilm - VS Code'), scene('d0b', dates[0], 14, 10, 'chrome', 'MDN — Canvas')],
          1
        )
      },
      { date: dates[1], day: rollup(dates[1], [scene('d1', dates[1], 9, 120, 'Code', 'dayfilm - VS Code')], 1) },
      {
        date: dates[2],
        day: rollup(
          dates[2],
          [scene('d2a', dates[2], 8, 20, 'chrome', 'MDN — Canvas'), scene('d2b', dates[2], 10, 60, 'chrome', 'MDN — CSS')],
          1
        )
      }
    ]
    const film = buildWeekFilm({ days, projects: PROJECTS, today: dates[6] })
    expect(film.acts[2].badges.some((badge) => badge.kind === 'switch')).toBe(true)
    const switchPick = pickWeekHighlights(film, PROJECTS).find((pick) => pick.reason.startsWith('换戏'))
    expect(switchPick?.scene.id).toBe('d2a')
    expect(switchPick?.reason).toBe('换戏 · 阅读')
  })

  test('最多 7 条', () => {
    const dates = weekDates('2025-01-13')
    // 每天三条不同项目/进程 + 多次换戏，候选超过 7
    const scenesByDay: Record<number, Scene[]> = {}
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const date = dates[dayIndex]
      scenesByDay[dayIndex] = [
        scene(`${date}-p1`, date, 8, 10 + dayIndex, 'Code', 'dayfilm - VS Code'),
        scene(`${date}-p2`, date, 10, 10, 'chrome', 'MDN — Canvas'),
        scene(`${date}-p3`, date, 12, 10, 'Notion', 'notion page'),
        scene(`${date}-p4`, date, 14, 10, 'slack', 'slack channel')
      ]
    }
    const film = buildWeekFilm({ days: week(scenesByDay), projects: PROJECTS, today: dates[6] })
    const picks = pickWeekHighlights(film, PROJECTS)
    expect(picks.length).toBeLessThanOrEqual(7)
    expect(picks.length).toBeGreaterThanOrEqual(5)
    const keys = picks.map((pick) => `${pick.date}|${pick.scene.start}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('无项目规则时按进程名取登场镜头', () => {
    const dates = weekDates('2025-01-13')
    const film = buildWeekFilm({
      days: week({
        // 最早的两个镜头是不归属故事线的 slack，最密窗口落在它们身上
        0: [
          scene('s1', dates[0], 8, 5, 'slack', 'slack channel'),
          scene('s2', dates[0], 8.17, 5, 'slack', 'slack other'),
          scene('a', dates[0], 9, 10, 'chrome', 'MDN — Canvas'),
          scene('c', dates[0], 10, 5, 'Code', 'dayfilm'),
          scene('b', dates[0], 11, 40, 'Code', 'dayfilm notes')
        ]
      }),
      projects: [],
      today: dates[6]
    })
    const reasons = pickWeekHighlights(film, []).map((pick) => pick.reason)
    expect(reasons).toContain('chrome 本周登场')
    expect(reasons).toContain('Code 本周登场')
  })
})
