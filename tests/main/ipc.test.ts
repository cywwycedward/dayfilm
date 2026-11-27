import { describe, expect, it } from 'vitest'
import {
  GUARDED_CHANNELS,
  HUD_OPEN_CHANNEL,
  MAXIMIZED_CHANGED_CHANNEL,
  OUTBOUND_CHANNELS,
  PROJECTION_TOGGLE_CHANNEL,
  SEND_CHANNELS,
  WINDOW_CHANNELS,
  createHandlers,
  createSendHandlers,
  parseDayRequest,
  type IpcDeps
} from '../../src/main/ipc'
import { IPC } from '../../src/shared/ipc'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import type { DayRollup, LiveState, Scene, SearchOutcome } from '../../src/shared/types'
import { searchOutcome } from '../../src/main/reel/search'

const EMPTY_DAY: DayRollup = {
  date: '2026-11-22',
  firstAt: null,
  lastAt: null,
  activeMs: 0,
  idleMs: 0,
  scenes: [],
  cuts: 0,
  longestShot: null,
  topApps: [],
  verdict: { label: '长镜头', note: '今天还没有形成长镜头。', cutRate: 0 },
  featureMs: 0,
  extraMs: 0
}

const EMPTY_LIVE: LiveState = {
  capturing: false,
  captureError: null,
  storageError: null,
  paused: false,
  now: 0,
  scene: null,
  day: EMPTY_DAY
}

const EMPTY_SEARCH: SearchOutcome = { hits: [], coverage: 'full', retainedFrom: null }

/** 记录调用顺序与参数的假实现，用来确认每个通道都接到了实现上。 */
function fakeDeps(): IpcDeps & { calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = []
  const track = <T>(name: string, result: T) => {
    return (...args: unknown[]): T => {
      calls.push([name, args])
      return result
    }
  }
  return {
    calls,
    getDay: track('getDay', EMPTY_DAY),
    listDays: track('listDays', ['2026-11-22']),
    live: track('live', EMPTY_LIVE),
    search: track('search', EMPTY_SEARCH),
    previousEpisode: track('previousEpisode', null),
    exportScreenplay: track('exportScreenplay', { path: '' }),
    getSettings: track('getSettings', DEFAULT_SETTINGS),
    setSettings: track('setSettings', DEFAULT_SETTINGS),
    getNote: track('getNote', '今天拍得不错'),
    setNote: track('setNote', '今天拍得不错'),
    saveImage: track('saveImage', { path: '' }),
    exportEdl: track('exportEdl', { path: '' }),
    exportPdf: track('exportPdf', { path: '' }),
    setMark: track('setMark', EMPTY_DAY),
    suggestStories: track('suggestStories', { candidates: [], failure: null }),
    aiStories: track('aiStories', Promise.resolve({ candidates: [], failure: null })),
    aiProbe: track('aiProbe', Promise.resolve({ ok: false, detail: '未配置' })),
    setHud: track('setHud', { visible: true }),
    quit: track('quit', undefined)
  }
}

describe('parseDayRequest', () => {
  it('缺省或非字符串取今天', () => {
    expect(parseDayRequest(undefined)).toEqual({ kind: 'today' })
    expect(parseDayRequest('')).toEqual({ kind: 'invalid', date: '' })
    expect(parseDayRequest(20261122)).toEqual({ kind: 'today' })
  })

  it('合法日期原样返回', () => {
    expect(parseDayRequest('2026-11-22')).toEqual({ kind: 'requested', date: '2026-11-22' })
  })

  it('非法日期保留请求的日期，空汇总要回填它而不是今天', () => {
    expect(parseDayRequest('yesterday')).toEqual({ kind: 'invalid', date: 'yesterday' })
    expect(parseDayRequest('2026-1-2')).toEqual({ kind: 'invalid', date: '2026-1-2' })
  })
})

describe('IPC 通道表', () => {
  it('除 tick 外，IPC 里的每个通道都在受守卫列表里（新增通道漏包装会失败）', () => {
    const expected = Object.values(IPC).filter((channel) => channel !== IPC.tick)
    const actual = Object.values(GUARDED_CHANNELS)
    expect([...actual].sort()).toEqual([...expected].sort())
    expect(actual).not.toContain(IPC.tick)
    expect(new Set(actual).size).toBe(actual.length)
  })

  it('每个受守卫通道都有实现，且都是函数', () => {
    const handlers = createHandlers(fakeDeps())
    expect(Object.keys(handlers).sort()).toEqual([...Object.values(GUARDED_CHANNELS)].sort())
    for (const channel of Object.values(GUARDED_CHANNELS)) {
      expect(typeof handlers[channel], channel).toBe('function')
    }
  })

  it('每个通道都把入参原样交给实现', () => {
    const deps = fakeDeps()
    const handlers = createHandlers(deps)
    handlers[IPC.getDay]('2026-11-22')
    handlers[IPC.listDays]()
    handlers[IPC.live]()
    handlers[IPC.search]('code')
    handlers[IPC.previousEpisode]('2026-11-22')
    handlers[IPC.exportScreenplay]('2026-11-22')
    handlers[IPC.getSettings]()
    handlers[IPC.setSettings]({ paused: true })
    handlers[IPC.getNote]('2026-11-22')
    handlers[IPC.setNote]('2026-11-22', '加油')
    handlers[IPC.saveImage]('poster', 'iVBORw0KGgo=')
    handlers[IPC.exportEdl]('2026-11-22')
    handlers[IPC.exportPdf]('2026-11-22')
    handlers[IPC.setHud](false)
    handlers[IPC.quit]()
    expect(deps.calls).toEqual([
      ['getDay', ['2026-11-22']],
      ['listDays', []],
      ['live', []],
      ['search', ['code']],
      ['previousEpisode', ['2026-11-22']],
      ['exportScreenplay', ['2026-11-22']],
      ['getSettings', []],
      ['setSettings', [{ paused: true }]],
      ['getNote', ['2026-11-22']],
      ['setNote', ['2026-11-22', '加油']],
      ['saveImage', ['poster', 'iVBORw0KGgo=']],
      ['exportEdl', ['2026-11-22']],
      ['exportPdf', ['2026-11-22']],
      ['setHud', [false]],
      ['quit', []]
    ])
  })

  it('导出失败的 rejection 不会被吞掉（会回到界面）', async () => {
    const deps = fakeDeps()
    deps.exportEdl = () => Promise.reject(new Error('EDL 保存失败：没有写入权限（EACCES）'))
    const handlers = createHandlers(deps)
    await expect(Promise.resolve(handlers[IPC.exportEdl]('2026-11-22'))).rejects.toThrow(
      /EDL 保存失败：没有写入权限/
    )
  })
})

describe('search 通道：保留范围与覆盖状态', () => {
  // 固定“今天”为 2026-11-27，保留 30 天 → 保留范围内最早一天是 10-29
  const NOW = new Date(2026, 10, 27, 12, 0, 0, 0).getTime()
  const RETENTION_DAYS = 30
  const pad = (value: number): string => String(value).padStart(2, '0')
  // 主进程的 keptDays()：保留期内、且确实有日文件的日期（倒序）
  const retained = Array.from({ length: RETENTION_DAYS }, (_, back) => {
    const date = new Date(2026, 10, 27 - back)
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  })

  function dayAt(date: string): DayRollup {
    const [year, month, day] = date.split('-').map(Number)
    const start = new Date(year, month - 1, day, 10).getTime()
    const scene: Scene = {
      id: date,
      start,
      end: start + 600_000,
      exe: 'Code',
      title: '季度报表 - Visual Studio Code',
      seconds: 600,
      kind: 'shot'
    }
    return {
      ...EMPTY_DAY,
      date,
      firstAt: start,
      lastAt: start + 600_000,
      activeMs: 600_000,
      scenes: [scene],
      longestShot: scene,
      featureMs: 600_000
    }
  }

  // 11-26 / 11-19 / 10-29 有日文件；11-20 在保留期内但没有日文件；10-28 已被清理
  const days = new Map(['2026-11-26', '2026-11-19', '2026-10-29'].map((date) => [date, dayAt(date)]))

  /** 走真正的 search 通道实现（createHandlers → searchOutcome），而不是只测纯函数。 */
  function search(query: string): SearchOutcome {
    const deps: IpcDeps = {
      ...fakeDeps(),
      search: (raw) =>
        searchOutcome(
          raw,
          { retained: () => retained, day: (date) => days.get(date) ?? { ...EMPTY_DAY, date } },
          NOW
        )
    }
    return createHandlers(deps)[IPC.search](query) as SearchOutcome
  }

  it('保留期内的日期：full，且命中那天的镜头', () => {
    for (const date of ['2026-11-26', '2026-11-19', '2026-10-29']) {
      const outcome = search(date)
      expect(outcome.coverage, date).toBe('full')
      expect(outcome.retainedFrom).toBe('2026-10-29')
      expect(outcome.hits.map((hit) => hit.scene.id)).toEqual([date])
    }
  })

  it('保留边界的前一天：expired，同时报出 retainedFrom', () => {
    const outcome = search('2026-10-28')
    expect(outcome.coverage).toBe('expired')
    expect(outcome.retainedFrom).toBe('2026-10-29')
    expect(outcome.hits).toEqual([])
  })

  it('保留期内但没有日文件：不是 expired，只是没有命中', () => {
    const outcome = search('2026-11-20')
    expect(outcome.coverage).toBe('full')
    expect(outcome.retainedFrom).toBe('2026-10-29')
    expect(outcome.hits).toEqual([])
  })

  it('没有保留数据时 retainedFrom 为 null，覆盖状态仍为 full', () => {
    const handlers = createHandlers({
      ...fakeDeps(),
      search: (raw) => searchOutcome(raw, { retained: () => [], day: () => EMPTY_DAY }, NOW)
    })
    expect(handlers[IPC.search]('报表')).toEqual({ hits: [], coverage: 'full', retainedFrom: null })
  })
})

describe('单向 send 通道', () => {
  it('send 通道登记在案且不与 invoke 通道撞名', () => {
    const send = Object.values(SEND_CHANNELS)
    const invoke = Object.values(GUARDED_CHANNELS)
    expect(send).toEqual([HUD_OPEN_CHANNEL])
    expect(send.filter((channel) => invoke.includes(channel as never))).toEqual([])
    // 契约里的 tick 也是单向通道，不能被当成 invoke 包装
    expect(invoke).not.toContain(IPC.tick)
  })

  it('每个 send 通道都有实现', () => {
    const calls: string[] = []
    const handlers = createSendHandlers({ hudOpen: () => calls.push('hudOpen') })
    expect(Object.keys(handlers).sort()).toEqual([...Object.values(SEND_CHANNELS)].sort())
    for (const channel of Object.values(SEND_CHANNELS)) handlers[channel]()
    expect(calls).toEqual(['hudOpen'])
  })
})

describe('主进程 → 渲染进程通道', () => {
  it('出站通道登记在案，且不与其它通道撞名', () => {
    const outbound = Object.values(OUTBOUND_CHANNELS)
    expect(outbound).toEqual([PROJECTION_TOGGLE_CHANNEL, MAXIMIZED_CHANGED_CHANNEL])
    const inUse = [
      ...Object.values(GUARDED_CHANNELS),
      ...Object.values(SEND_CHANNELS),
      ...Object.values(WINDOW_CHANNELS),
      IPC.tick
    ] as string[]
    expect(outbound.filter((channel) => inUse.includes(channel))).toEqual([])
    for (const channel of outbound) expect(channel.startsWith('dayfilm:')).toBe(true)
  })
})

describe('无边框窗口通道', () => {
  it('三个窗口按钮通道登记在案，不与其它通道撞名', () => {
    const window = Object.values(WINDOW_CHANNELS)
    expect([...window].sort()).toEqual(['window:close', 'window:minimize', 'window:toggle-maximize'])
    const inUse = [
      ...Object.values(GUARDED_CHANNELS),
      ...Object.values(SEND_CHANNELS),
      ...Object.values(OUTBOUND_CHANNELS),
      IPC.tick
    ] as string[]
    expect(window.filter((channel) => inUse.includes(channel))).toEqual([])
    expect(new Set(window).size).toBe(window.length)
  })
})
