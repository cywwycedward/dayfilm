/**
 * 确定性 mock 数据：没有 window.dayfilm 时（本地 vite 预览、演示、测试）用同一份
 * 伪随机序列生成一整天的镜头，保证界面可以独立开发。
 */
import type { DayRollup, LiveState, Scene, SceneKind, TopApp, Verdict } from '../../shared/types'
import { hashString, seededRandom } from './lib/hash'
import { fmtDuration, isoDate, startOfDay } from './lib/time'

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY_MS = 86_400_000

interface AppProfile {
  exe: string
  titles: string[]
}

const APPS: AppProfile[] = [
  {
    exe: 'Code',
    titles: [
      'dayfilm - Visual Studio Code',
      'reel.ts - dayfilm - Visual Studio Code',
      'capture.ps1 - dayfilm - Visual Studio Code',
      'style.css - dayfilm - Visual Studio Code'
    ]
  },
  {
    exe: 'WindowsTerminal',
    titles: ['PowerShell — dayfilm', 'npm run build — dayfilm', 'git log — dayfilm']
  },
  {
    exe: 'chrome',
    titles: [
      'GitHub — dayfilm',
      'Canvas API — MDN Web Docs',
      'Electron IPC 文档',
      'Figma — Dayfilm 界面'
    ]
  },
  { exe: 'Notion', titles: ['Dayfilm 设计笔记', '本周复盘'] },
  { exe: 'Figma', titles: ['Dayfilm — 胶片视觉', 'Dayfilm — 手机草稿'] },
  { exe: 'WeChat', titles: ['微信'] },
  { exe: 'Slack', titles: ['#design — Dayfilm', '#eng — Dayfilm'] },
  { exe: 'Explorer', titles: ['dayfilm', 'Downloads'] }
]

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))]
}

function verdictFor(cuts: number, activeMs: number, longest: Scene | null): Verdict {
  const hours = activeMs / HOUR
  const cutRate = hours > 0 ? cuts / hours : 0
  if (!longest || activeMs === 0) {
    return { label: '未开镜', note: '还没有拍摄任何素材，今天这卷胶片是空的。', cutRate: 0 }
  }
  const anchor = `最长的一个镜头 ${fmtDuration(longest.seconds)}（${longest.exe}）`
  if (cutRate > 20) {
    return {
      label: '跳切风暴',
      note: `平均每小时 ${cutRate.toFixed(0)} 次切换，${anchor} 是唯一没被打断的段落。`,
      cutRate
    }
  }
  if (cutRate > 8) {
    return {
      label: '快切',
      note: `平均每小时 ${cutRate.toFixed(0)} 次切换，注意力被切成碎条；${anchor}。`,
      cutRate
    }
  }
  if (cutRate >= 3) {
    return {
      label: '标准剪辑',
      note: `平均每小时 ${cutRate.toFixed(1)} 次切换，节奏稳；${anchor}。`,
      cutRate
    }
  }
  return {
    label: '长镜头',
    note: `平均每小时 ${cutRate.toFixed(1)} 次切换，几乎一路到底；${anchor}。`,
    cutRate
  }
}

function rollup(dateISO: string, scenes: Scene[]): DayRollup {
  let activeMs = 0
  let idleMs = 0
  let cuts = 0
  let previous: SceneKind | null = null
  let longest: Scene | null = null
  const byExe = new Map<string, number>()
  for (const scene of scenes) {
    if (scene.kind === 'shot') {
      activeMs += scene.seconds * 1000
      if (previous === 'shot') cuts += 1
      byExe.set(scene.exe, (byExe.get(scene.exe) ?? 0) + scene.seconds)
      if (!longest || scene.seconds > longest.seconds) longest = scene
    } else {
      idleMs += scene.seconds * 1000
    }
    previous = scene.kind
  }
  const topApps: TopApp[] = [...byExe.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([exe, seconds]) => ({ exe, seconds }))
  return {
    date: dateISO,
    firstAt: scenes.length > 0 ? scenes[0].start : null,
    lastAt: scenes.length > 0 ? scenes[scenes.length - 1].end : null,
    activeMs,
    idleMs,
    scenes,
    cuts,
    longestShot: longest,
    topApps,
    verdict: verdictFor(cuts, activeMs, longest)
  }
}

export interface MockDayOptions {
  /** 密集模式：整天都是几十秒级别的短镜头，用于验收长列表性能 */
  dense?: boolean
}

/**
 * 生成某一天截至 nowMs 的完整胶片。
 * 相同 (dateISO, nowMs) 永远得到相同结果；nowMs 提前只会截短影片，不会改写已有镜头。
 */
export function buildMockDay(dateISO: string, nowMs: number, options: MockDayOptions = {}): DayRollup {
  const dense = options.dense === true
  const dayStart = startOfDay(dateISO)
  const end = Math.min(Math.max(nowMs, dayStart), dayStart + DAY_MS)
  const random = seededRandom(hashString(`mock|${dateISO}`))
  const scenes: Scene[] = []

  const push = (start: number, stop: number, exe: string, title: string, kind: SceneKind): void => {
    const from = Math.round(start)
    const to = Math.round(stop)
    if (to - from < 3000) return
    scenes.push({
      id: `${dateISO}-${scenes.length + 1}`,
      start: from,
      end: to,
      exe,
      title,
      seconds: (to - from) / 1000,
      kind
    })
  }

  // 09:00–09:40 开机；如果 nowMs 太早，则留 8 分钟给第一个镜头
  const planned = dayStart + 9 * HOUR + Math.floor(random() * 40) * MINUTE
  let cursor = Math.min(planned, Math.max(dayStart, end - 8 * MINUTE))
  // 每四天有一天只做设计与杂事，让周视图里能看到主角切换与换戏
  const designDay = Math.floor(dayStart / DAY_MS) % 4 === 2
  const pool = designDay
    ? APPS.filter((app) => app.exe === 'Notion' || app.exe === 'Figma' || app.exe === 'Slack')
    : APPS

  while (cursor + 90_000 < end) {
    const block = dense ? 12 + Math.floor(random() * 20) : 1 + Math.floor(random() * 3)
    for (let i = 0; i < block && cursor + 60_000 < end; i += 1) {
      const app = pick(pool, random)
      const title = pick(app.titles, random)
      const minutes = dense ? 0.3 + random() * 0.9 : 2 + random() * 26
      const stop = Math.min(end, cursor + Math.floor(minutes * MINUTE))
      push(cursor, stop, app.exe, title, 'shot')
      cursor = stop + Math.floor(random() * 5000)
    }
    if (!dense && random() < 0.6) {
      const stop = Math.min(end, cursor + Math.floor((3 + random() * 34) * MINUTE))
      push(cursor, stop, '', '中场休息', 'intermission')
      cursor = stop
    }
    // 让时间推进，避免空转；这段空隙代表 sampler 没在运行的时段
    cursor += dense ? Math.floor(random() * 3000) : Math.floor((2 + random() * 25) * MINUTE)
  }

  while (scenes.length > 0 && scenes[scenes.length - 1].kind === 'intermission') scenes.pop()
  const last = scenes[scenes.length - 1]
  if (last) {
    if (end - last.start < 3000) scenes.pop()
    else {
      last.end = Math.round(end)
      last.seconds = (last.end - last.start) / 1000
    }
  }

  return rollup(dateISO, scenes)
}

/** mock 的实时状态：最后一个镜头就是"正在拍摄"的那一个。 */
export interface MockLiveOptions extends MockDayOptions {
  captureError?: string | null
  storageError?: string | null
  paused?: boolean
}

export function buildMockLive(
  dateISO: string,
  nowMs: number,
  options: MockLiveOptions = {}
): LiveState {
  const captureError = options.captureError ?? null
  const storageError = options.storageError ?? null
  const paused = options.paused === true
  const day = buildMockDay(dateISO, nowMs, { dense: options.dense })
  const last = day.scenes[day.scenes.length - 1]
  return {
    capturing: captureError === null,
    captureError,
    storageError,
    paused,
    now: nowMs,
    scene: last && last.kind === 'shot' ? last : null,
    day
  }
}

/** mock 提供最近两周（14 天），供周视图与上一周对比演示。 */
export function mockDates(nowMs: number): string[] {
  const today = startOfDay(isoDate(nowMs))
  const dates: string[] = []
  for (let back = 13; back >= 0; back -= 1) dates.push(isoDate(today - back * DAY_MS))
  return dates
}
