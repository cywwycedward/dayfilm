import { describe, expect, it } from 'vitest'
import { CANDIDATE_MIN_MS, extractEntities, normalizeTitle, storyCandidates } from '../../src/shared/stories'
import type { DayRollup, Scene } from '../../src/shared/types'

const MINUTE = 60_000
const BASE = new Date(2026, 10, 22, 9, 0, 0, 0).getTime()

function scene(index: number, minutes: number, exe: string, title: string): Scene {
  const start = BASE + index * 60 * MINUTE
  return {
    id: `s${index}`,
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

describe('normalizeTitle', () => {
  it('去掉「- 应用名」后缀但保留仓库名', () => {
    expect(normalizeTitle('fix-login-bug.ts - dayfilm - Visual Studio Code')).toBe('fix-login-bug.ts - dayfilm')
  })

  it('去掉未读计数、页面数量与全角括号', () => {
    expect(normalizeTitle('(3) GitHub')).toBe('GitHub')
    expect(normalizeTitle('ChatGPT 和另外 5 个页面 - 个人')).toBe('ChatGPT')
    expect(normalizeTitle('[DF-412]（2）登录失败')).toBe('[DF-412]登录失败')
  })

  it('去掉盘符前缀与脏标记', () => {
    expect(normalizeTitle('*D:\\work\\repo\\layer.py - auto-carto')).toBe('layer.py - auto-carto')
  })

  it('空标题保持为空', () => {
    expect(normalizeTitle('')).toBe('')
    expect(normalizeTitle('   ')).toBe('')
  })
})

describe('extractEntities', () => {
  it('文件名取主干、issue 号取前缀', () => {
    const entities = extractEntities('fix-login-bug.ts - dayfilm - Visual Studio Code', 'Code')
    expect(entities).toContain('fix-login-bug')
    expect(entities).toContain('dayfilm')
    expect(entities).not.toContain('visual')
  })

  it('issue 前缀与中文短语都能抽出来', () => {
    const entities = extractEntities('[DF-412] 登录失败 · PR #88 · GitHub')
    expect(entities).toContain('df')
    expect(entities).toContain('登录失败')
    expect(entities).not.toContain('github')
    expect(entities).not.toContain('pr')
  })

  it('排除进程名与噪声词', () => {
    expect(extractEntities('index.md - dayfilm', 'dayfilm')).not.toContain('dayfilm')
    expect(extractEntities('README.md - repo')).not.toContain('readme')
  })

  it('归一化后再抽，重复词只出现一次', () => {
    expect(extractEntities('dayfilm dayfilm - Code')).toEqual(['dayfilm'])
  })
})

describe('storyCandidates', () => {
  it('镜头数不足 5 的实体不出候选', () => {
    const scenes = Array.from({ length: 4 }, (_, index) => scene(index, 10, 'Code', 'login.ts - app'))
    expect(storyCandidates([dayOf('2026-11-22', scenes)])).toEqual([])
  })

  it('满足镜头数与时长、且跨 2 天时出候选', () => {
    const first = Array.from({ length: 3 }, (_, index) => scene(index, 6, 'Code', 'login.ts - app'))
    const second = Array.from({ length: 2 }, (_, index) => scene(index + 3, 6, 'Code', 'login.ts - app'))
    const candidates = storyCandidates([dayOf('2026-11-21', first), dayOf('2026-11-22', second)])
    const login = candidates.find((item) => item.term === 'login')
    expect(login).toBeDefined()
    expect(login?.scenes).toBe(5)
    expect(login?.ms).toBeGreaterThanOrEqual(CANDIDATE_MIN_MS)
    expect(login?.source).toBe('template')
  })

  it('只占一天时要求 ≥3 个进程', () => {
    const oneApp = Array.from({ length: 5 }, (_, index) => scene(index, 6, 'Code', 'login.ts'))
    expect(storyCandidates([dayOf('2026-11-22', oneApp)]).map((item) => item.term)).not.toContain('login')

    const threeApps = [
      scene(0, 6, 'Code', 'login.ts'),
      scene(1, 6, 'Code', 'login.ts'),
      scene(2, 6, 'msedge', 'login.ts'),
      scene(3, 6, 'msedge', 'login.ts'),
      scene(4, 6, 'WindowsTerminal', 'login.ts')
    ]
    expect(storyCandidates([dayOf('2026-11-22', threeApps)]).map((item) => item.term)).toContain('login')
  })

  it('已被规则覆盖的实体不再建议', () => {
    const scenes = Array.from({ length: 6 }, (_, index) => scene(index, 6, 'Code', 'login.ts'))
    const rules = [{ name: '认证', terms: ['login'] }]
    expect(storyCandidates([dayOf('2026-11-22', scenes)], rules)).toEqual([])
  })

  it('互为子串的候选只留一个，顺序稳定', () => {
    // 两个候选都要过门槛：跨 3 个进程，避免被“单日单进程”规则筛掉
    const scenes = [
      ...Array.from({ length: 2 }, (_, index) => scene(index, 5, 'Code', 'dayfilm.ts')),
      ...Array.from({ length: 2 }, (_, index) => scene(index + 2, 5, 'msedge', 'dayfilm.ts - GitHub')),
      ...Array.from({ length: 2 }, (_, index) => scene(index + 4, 5, 'WindowsTerminal', 'dayfilm test')),
      ...Array.from({ length: 2 }, (_, index) => scene(index + 6, 5, 'Code', 'day.ts')),
      ...Array.from({ length: 1 }, (_, index) => scene(index + 8, 5, 'msedge', 'day.ts - GitHub')),
      ...Array.from({ length: 2 }, (_, index) => scene(index + 9, 5, 'WindowsTerminal', 'day plan'))
    ]
    const first = storyCandidates([dayOf('2026-11-22', scenes)])
    const second = storyCandidates([dayOf('2026-11-22', scenes)])
    expect(first.map((item) => item.term)).toEqual(second.map((item) => item.term))
    expect(first.some((item) => item.term === 'dayfilm')).toBe(true)
    expect(first.some((item) => item.term === 'day')).toBe(false)
  })

  it('最多返回 8 条', () => {
    const scenes = Array.from({ length: 8 }, (_, index) => scene(index, 10, 'Code', `project-${index} tool`))
    const candidates = storyCandidates([dayOf('2026-11-22', scenes)], [], 8)
    expect(candidates.length).toBeLessThanOrEqual(8)
  })
})
