import { describe, expect, test } from 'vitest'
import type { ProjectRule } from '../../src/shared/settings'
import type { DayRollup, Scene } from '../../src/shared/types'
import {
  buildWeekFilm,
  buildWeekVerdict,
  mainLineOf,
  mondayOf,
  weekDates,
  weekMetrics,
  weekRangeLabel,
  type WeekDay
} from '../../src/renderer/src/lib/week-film'
import { startOfDay } from '../../src/renderer/src/lib/time'

const HOUR = 3_600_000
const MINUTE = 60_000

function scene(id: string, date: string, hour: number, minutes: number, exe: string, title = 'x', kind: Scene['kind'] = 'shot'): Scene {
  const start = startOfDay(date) + hour * HOUR
  return { id, start, end: start + minutes * MINUTE, exe, title, seconds: minutes * 60, kind }
}

function rollup(date: string, scenes: Scene[], cuts = 0): DayRollup {
  const shots = scenes.filter((item) => item.kind === 'shot')
  return {
    date,
    firstAt: scenes[0]?.start ?? null,
    lastAt: scenes[scenes.length - 1]?.end ?? null,
    activeMs: shots.reduce((sum, item) => sum + (item.end - item.start), 0),
    featureMs: shots.reduce((sum, item) => sum + (item.end - item.start), 0),
    extraMs: 0,
    idleMs: 0,
    scenes,
    cuts,
    longestShot: shots.reduce<Scene | null>((best, item) => (!best || item.seconds > best.seconds ? item : best), null),
    topApps: [],
    verdict: { label: '标准剪辑', note: '', cutRate: 0 }
  }
}

function day(date: string, scenes: Scene[], cuts = 0): WeekDay {
  return { date, day: rollup(date, scenes, cuts) }
}

const PROJECTS: ProjectRule[] = [
  { name: 'Dayfilm', terms: ['dayfilm'] },
  { name: '阅读', terms: ['mdn'] },
  { name: '写作', terms: ['notion'] }
]

describe('mondayOf', () => {
  test('周三落在本周一', () => {
    expect(mondayOf('2025-01-15')).toBe('2025-01-13') // 2025-01-15 是周三
  })

  test('周日算上一周的最后一天', () => {
    expect(mondayOf('2025-01-19')).toBe('2025-01-13')
  })

  test('周一是它自己', () => {
    expect(mondayOf('2025-01-13')).toBe('2025-01-13')
  })

  test('跨月', () => {
    expect(mondayOf('2025-02-02')).toBe('2025-01-27')
  })

  test('跨年', () => {
    expect(mondayOf('2026-01-01')).toBe('2025-12-29')
  })

  test('非法输入原样返回', () => {
    expect(mondayOf('bad')).toBe('bad')
  })
})

describe('weekDates 与周范围', () => {
  test('七个日期，从周一到周日', () => {
    const dates = weekDates('2025-01-13')
    expect(dates).toHaveLength(7)
    expect(dates[0]).toBe('2025-01-13')
    expect(dates[6]).toBe('2025-01-19')
    expect([...dates].sort()).toEqual(dates)
    for (const date of dates) expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('跨月的一周', () => {
    expect(weekDates('2025-01-27')).toEqual([
      '2025-01-27',
      '2025-01-28',
      '2025-01-29',
      '2025-01-30',
      '2025-01-31',
      '2025-02-01',
      '2025-02-02'
    ])
  })

  test('周范围文字', () => {
    expect(weekRangeLabel('2025-01-13')).toBe('1月13日 – 1月19日')
    expect(weekRangeLabel('2025-01-27')).toBe('1月27日 – 2月2日')
    expect(weekRangeLabel('2025-12-29')).toBe('2025年12月29日 – 1月4日')
  })
})

describe('mainLineOf', () => {
  test('有项目规则时用项目名', () => {
    const line = mainLineOf(rollup('2025-01-15', [scene('a', '2025-01-15', 9, 60, 'Code', 'dayfilm - VS Code')]), PROJECTS)
    expect(line).toEqual({ name: 'Dayfilm', ms: HOUR, kind: 'project' })
  })

  test('没有项目规则时回退到进程名', () => {
    const line = mainLineOf(
      rollup('2025-01-15', [scene('a', '2025-01-15', 9, 30, 'Code'), scene('b', '2025-01-15', 10, 45, 'chrome')]),
      []
    )
    expect(line).toEqual({ name: 'chrome', ms: 45 * MINUTE, kind: 'app' })
  })

  test('并列时按名称字典序，结果确定', () => {
    const line = mainLineOf(
      rollup('2025-01-15', [scene('a', '2025-01-15', 9, 30, 'chrome'), scene('b', '2025-01-15', 10, 30, 'Code')]),
      []
    )
    expect(line?.name).toBe('Code')
  })

  test('没有数据或没有命中项目时没有主线', () => {
    expect(mainLineOf(null, PROJECTS)).toBeNull()
    expect(mainLineOf(rollup('2025-01-15', [scene('a', '2025-01-15', 9, 30, 'Code', 'README')]), PROJECTS)).toBeNull()
  })
})

describe('weekMetrics', () => {
  test('三项指标来自整周，今天之后不计入', () => {
    const days: WeekDay[] = [
      day('2025-01-13', [scene('a', '2025-01-13', 9, 60, 'Code')], 2),
      day('2025-01-14', [scene('b', '2025-01-14', 9, 30, 'Code')], 1),
      day('2025-01-15', [scene('c', '2025-01-15', 9, 120, 'Code')], 5)
    ]
    const metrics = weekMetrics(days, '2025-01-14')
    expect(metrics.activeMs).toBe(90 * MINUTE)
    expect(metrics.cuts).toBe(3)
    expect(metrics.longestSeconds).toBe(60 * 60)
    expect(metrics.cutRate).toBeCloseTo(2, 6)
  })

  test('没有活跃时长时剪辑密度是 0 而不是 NaN', () => {
    const metrics = weekMetrics([day('2025-01-13', [])], '2025-01-13')
    expect(metrics.cutRate).toBe(0)
    expect(Number.isNaN(metrics.cutRate)).toBe(false)
  })
})

describe('buildWeekFilm：七幕与故事线', () => {
  const monday = '2025-01-13'
  const dates = weekDates(monday)
  const days: WeekDay[] = [
    day(dates[0], [scene('a1', dates[0], 9, 90, 'Code', 'dayfilm - Visual Studio Code')], 3),
    day(dates[1], [scene('b1', dates[1], 9, 60, 'Code', 'dayfilm - Visual Studio Code')], 2),
    day(dates[2], [scene('c1', dates[2], 9, 45, 'Code', 'dayfilm - Visual Studio Code')], 1),
    day(dates[3], [scene('d1', dates[3], 9, 30, 'chrome', 'MDN — Canvas')], 0),
    { date: dates[4], day: null },
    day(dates[5], [scene('f1', dates[5], 9, 20, 'chrome', 'MDN — Canvas')], 0),
    { date: dates[6], day: null }
  ]
  const today = dates[6]
  const film = buildWeekFilm({ days, projects: PROJECTS, today })

  test('七幕按日期排列，带星期与主线', () => {
    expect(film.acts).toHaveLength(7)
    expect(film.acts[0].weekday).toBe('周一')
    expect(film.acts[0].mainLine).toBe('Dayfilm')
    expect(film.acts[0].kind).toBe('project')
    expect(film.acts[3].mainLine).toBe('阅读')
    expect(film.acts[4].mainLine).toBeNull()
    expect(film.acts[4].hasData).toBe(false)
  })

  test('长主线连续三天标在最后一天', () => {
    expect(film.acts[2].badges.some((badge) => badge.kind === 'run')).toBe(true)
    expect(film.acts[2].badges[0].text).toBe('Dayfilm · 连续 3 天')
    expect(film.acts[0].badges.some((badge) => badge.kind === 'run')).toBe(false)
  })

  test('故事线按周总时长倒序，最多 5 行，格子覆盖 7 天', () => {
    expect(film.rows.map((row) => row.line)).toEqual(['Dayfilm', '阅读'])
    expect(film.rows[0].cells).toHaveLength(7)
    expect(film.rows[0].cells[4]).toMatchObject({ date: dates[4], ms: 0, level: 0 })
    expect(film.rows[0].cells[0].level).toBe(1)
  })

  test('亮度按行内最大值平方根压缩', () => {
    const dayfilm = film.rows[0]
    const ratio = Math.sqrt(60 / 90)
    expect(dayfilm.cells[1].level).toBeCloseTo(ratio, 6)
  })

  test('故事线最多 5 行', () => {
    const many = weekDates('2025-01-13').map((date, index) => {
      const scenes = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name, slot) =>
        scene(`${date}-${name}`, date, 8 + slot, 10 + index, `app-${name}`, `${name} dayfilm`)
      )
      return day(date, scenes, 1)
    })
    const wide = buildWeekFilm({ days: many, projects: [], today: '2025-01-19' })
    expect(wide.rows.length).toBe(5)
    expect(wide.rows[0].totalMs).toBeGreaterThanOrEqual(wide.rows[4].totalMs)
  })

  test('未来日期不算数据，也不显示为 0', () => {
    const future = buildWeekFilm({ days, projects: PROJECTS, today: dates[2] })
    expect(future.acts[3].future).toBe(true)
    expect(future.acts[3].hasData).toBe(false)
    expect(future.acts[3].cuts).toBe(0)
    expect(future.metrics.activeMs).toBe(90 * MINUTE + 60 * MINUTE + 45 * MINUTE)
  })

  test('换戏：与前一天不同且在本周前二', () => {
    const switched = film.acts[3]
    expect(switched.badges.some((badge) => badge.kind === 'switch')).toBe(true)
  })

  test('换戏要求本周时长前二：第三名的主线切换不标', () => {
    const dates2 = weekDates('2025-01-13')
    const days2: WeekDay[] = [
      day(dates2[0], [scene('a', dates2[0], 8, 200, 'Code', 'dayfilm')], 1),
      day(dates2[1], [scene('b', dates2[1], 8, 10, 'chrome', 'MDN')], 0),
      day(dates2[2], [scene('c', dates2[2], 8, 10, 'slack', 'Slack')], 0)
    ]
    const small = buildWeekFilm({ days: days2, projects: PROJECTS, today: dates2[6] })
    // 只有 Dayfilm 与 阅读 命中项目；slack 没有项目 → 无主线，不会标换戏
    const slackAct = small.acts[2]
    expect(slackAct.mainLine).toBeNull()
    expect(slackAct.badges).toHaveLength(0)
  })

  test('连续两天不算长主线', () => {
    const short = buildWeekFilm({
      days: [days[0], days[1], { date: dates[2], day: null }],
      projects: PROJECTS,
      today
    })
    expect(short.acts.flatMap((act) => act.badges).some((badge) => badge.kind === 'run')).toBe(false)
  })

  test('上周日的主线参与第一幕的换戏判断', () => {
    const previousSunday: WeekDay = day('2025-01-12', [scene('p', '2025-01-12', 9, 30, 'chrome', 'MDN — Canvas')], 0)
    const filmWithPrevious = buildWeekFilm({ days, projects: PROJECTS, today, previousSunday })
    expect(filmWithPrevious.acts[0].badges.some((badge) => badge.kind === 'switch')).toBe(true)
  })
})

describe('buildWeekVerdict', () => {
  const weekA = (monday: string, perDay: number[]): WeekDay[] =>
    weekDates(monday).map((date, index) =>
      perDay[index] > 0 ? day(date, [scene(`${date}-s`, date, 9, perDay[index], 'Code', 'dayfilm')], 2) : { date, day: null }
    )

  test('首周：没有可对比的上周', () => {
    const verdict = buildWeekVerdict(weekA('2025-01-13', [60, 30, 0, 0, 0, 0, 0]), weekA('2025-01-06', [0, 0, 0, 0, 0, 0, 0]))
    expect(verdict.hasPrevious).toBe(false)
    expect(verdict.sentence).toBe('这是第一周，还没有可以对比的上周。')
    expect(verdict.evidence).toHaveLength(3)
    expect(verdict.evidence.every((row) => row.previous === '—' && row.delta === '—')).toBe(true)
  })

  test('正常对比：只用变化最大的两项，数字来自本周', () => {
    // 活跃 +1250%、最长 +1100%、剪辑密度 −89% → 取前两项
    const verdict = buildWeekVerdict(weekA('2025-01-13', [120, 90, 60, 0, 0, 0, 0]), weekA('2025-01-06', [10, 10, 0, 0, 0, 0, 0]))
    expect(verdict.hasPrevious).toBe(true)
    expect(verdict.sentence).toContain('活跃时长')
    expect(verdict.sentence).toContain('本周最长镜头是 2 小时')
    expect(verdict.sentence).not.toContain('剪辑密度')
    expect(verdict.sentence.split('；')).toHaveLength(2)
    expect(verdict.sentence.endsWith('。')).toBe(true)
    for (const word of ['效率', '专注', '进展']) expect(verdict.sentence).not.toContain(word)
  })

  test('证据表三行，本周 / 上周 / 变化都有值', () => {
    const verdict = buildWeekVerdict(weekA('2025-01-13', [120, 90, 60, 0, 0, 0, 0]), weekA('2025-01-06', [10, 10, 0, 0, 0, 0, 0]))
    expect(verdict.evidence.map((row) => row.label)).toEqual(['最长镜头', '剪辑密度', '活跃时长'])
    for (const row of verdict.evidence) {
      expect(row.current).not.toBe('')
      expect(row.previous).not.toBe('—')
      expect(row.delta).toMatch(/^[+−]/)
    }
  })

  test('确定性：同样输入同样句子', () => {
    const thisWeek = weekA('2025-01-13', [120, 90, 60, 0, 0, 0, 0])
    const lastWeek = weekA('2025-01-06', [10, 10, 0, 0, 0, 0, 0])
    expect(buildWeekVerdict(thisWeek, lastWeek).sentence).toBe(buildWeekVerdict(thisWeek, lastWeek).sentence)
  })

  test('完全没变化时给一句中性总结而不是"多 0 分"', () => {
    const same = weekA('2025-01-13', [60, 30, 0, 0, 0, 0, 0])
    const verdict = buildWeekVerdict(same, weekA('2025-01-06', [60, 30, 0, 0, 0, 0, 0]))
    expect(verdict.sentence).toContain('基本一样')
    expect(verdict.sentence).not.toContain('多 0')
  })
})

describe('故事线矩阵规则', () => {
  const monday = '2025-01-13'
  const dates = weekDates(monday)
  // Dayfilm -> 阅读 -> 阅读 -> Dayfilm（回）-> 无记录 -> 写作 -> 未来
  const days: WeekDay[] = [
    day(dates[0], [scene('d0', dates[0], 9, 60, 'Code', 'dayfilm - VS Code')]),
    day(dates[1], [scene('d1', dates[1], 9, 70, 'chrome', 'MDN — Canvas')]),
    day(dates[2], [scene('d2', dates[2], 9, 2, 'chrome', 'MDN — CSS')]),
    day(dates[3], [scene('d3', dates[3], 9, 80, 'Code', 'dayfilm notes')]),
    { date: dates[4], day: null },
    day(dates[5], [scene('d5', dates[5], 9, 30, 'Notion', 'notion page')]),
    { date: dates[6], day: null }
  ]
  const film = buildWeekFilm({ days, projects: PROJECTS, today: dates[5] })
  const rowOf = (name: string) => {
    const found = film.rows.find((item) => item.line === name)
    if (!found) throw new Error(`missing row ${name}`)
    return found
  }

  test('每列主角与标记：切 / 回，无记录列没有主角', () => {
    expect(film.columns.map((column) => column.protagonist)).toEqual([
      'Dayfilm',
      '阅读',
      '阅读',
      'Dayfilm',
      null,
      '写作',
      null
    ])
    expect(film.columns.map((column) => column.mark)).toEqual([null, '切', null, '回', null, null, null])
    expect(film.columns.map((column) => column.noRecord)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
      false
    ])
    expect(film.columns[6].future).toBe(true)
  })

  test('一天只有一格描边，且落在当天主角行', () => {
    for (let index = 0; index < 7; index += 1) {
      const outlined = film.rows.filter((item) => item.cells[index].protagonist)
      const expected = film.columns[index].protagonist
      expect(outlined.map((item) => item.line)).toEqual(expected === null ? [] : [expected])
    }
  })

  test('连线只出现在相邻两天同一主角之间，回到旧主角不画幽灵线', () => {
    const reading = rowOf('阅读')
    expect(reading.cells[1].link).toBe(false)
    expect(reading.cells[2].link).toBe(true)
    const dayfilm = rowOf('Dayfilm')
    expect(dayfilm.cells[0].link).toBe(false)
    // 第四天回到 Dayfilm：前一天主角是阅读，不能跨过去连线
    expect(dayfilm.cells[3].link).toBe(false)
  })

  test('填充按四档透明度，空命中是暗格', () => {
    const alphas = new Set<number>()
    for (const item of film.rows) for (const cell of item.cells) alphas.add(cell.alpha)
    for (const value of alphas) expect([0, 0.25, 0.42, 0.62, 0.82]).toContain(value)
    expect(rowOf('Dayfilm').cells[0].alpha).toBe(0.82)
    expect(rowOf('阅读').cells[2].alpha).toBe(0.25)
    const emptyCell = rowOf('Dayfilm').cells[1]
    expect(emptyCell.empty).toBe(true)
    expect(emptyCell.alpha).toBe(0)
  })

  test('每行一个固定色相，同一周内互不相同', () => {
    const hues = film.rows.map((item) => item.hue)
    expect(new Set(hues).size).toBe(hues.length)
    for (const hue of hues) {
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    }
  })

  test('同一份数据算出的矩阵完全一致（确定性）', () => {
    expect(buildWeekFilm({ days, projects: PROJECTS, today: dates[5] })).toEqual(film)
  })

  test('无项目规则时用进程名当主角', () => {
    const apps = buildWeekFilm({
      days: [
        day(dates[0], [scene('x', dates[0], 9, 10, 'chrome', 'MDN'), scene('y', dates[0], 10, 40, 'Code', 'dayfilm')])
      ],
      projects: [],
      today: dates[0]
    })
    expect(apps.columns[0].protagonist).toBe('Code')
    expect(apps.rows.map((item) => item.kind)).toEqual(['app', 'app'])
  })

  test('有记录但没有项目命中：不硬塞主角', () => {
    const unmatched = buildWeekFilm({
      days: [day(dates[0], [scene('z', dates[0], 9, 30, 'slack', 'slack channel')])],
      projects: PROJECTS,
      today: dates[0]
    })
    expect(unmatched.columns[0].protagonist).toBeNull()
    expect(unmatched.columns[0].noRecord).toBe(false)
    expect(unmatched.rows).toEqual([])
  })
})
