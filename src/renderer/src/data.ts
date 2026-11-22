/**
 * 数据入口。唯一一条规则：window.dayfilm 不存在时用本地 mock，
 * 这样界面可以脱离主进程独立开发和演示。
 */
import type { DayfilmApi } from '../../shared/ipc'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings'
import type { DayRollup, LiveState, Scene } from '../../shared/types'
import { buildMockDay, buildMockLive, mockDates } from './mock'
import { fmtClock, fmtDuration, isoDate, startOfDay } from './lib/time'
import { mondayOf, weekDates } from './lib/week-film'

export interface DayfilmSource {
  readonly mode: 'live' | 'mock'
  listDays(): Promise<string[]>
  getDay(date: string): Promise<DayRollup>
  live(): Promise<LiveState>
  search(query: string): Promise<Scene[]>
  /** 返回供提示语展示的路径或说明。 */
  exportScreenplay(date: string): Promise<string>
  getSettings(): Promise<Settings>
  /** 只提交改动的字段，返回落盘后的完整设置。 */
  setSettings(patch: Partial<Settings>): Promise<Settings>
  /** 导演手记；没有时返回空串。 */
  getNote(date: string): Promise<string>
  setNote(date: string, text: string): Promise<string>
  /** 把 base64 PNG 存到用户选择的路径；返回空串表示用户取消。 */
  saveImage(defaultName: string, pngBase64: string): Promise<string>
  /** 真正退出应用。 */
  quit(): Promise<void>
  onTick(cb: (state: LiveState) => void): () => void
}

/**
 * 新版 preload 才有的通道：缺失时给出可读错误，而不是假装保存成功。
 * 这样旧构建下打开设置面板会看到明确提示，界面不会崩。
 */
function missing(name: string): Promise<never> {
  return Promise.reject(new Error(`当前构建未暴露 ${name} 接口，重启应用后再试`))
}

function liveSource(api: DayfilmApi): DayfilmSource {
  // 预加载脚本可能落后于 shared 契约，按运行时实际暴露的成员判断
  const exposed = api as Partial<DayfilmApi>
  return {
    mode: 'live',
    listDays: () => api.listDays(),
    getDay: (date) => api.getDay(date),
    live: () => api.live(),
    search: (query) => api.search(query),
    exportScreenplay: async (date) => (await api.exportScreenplay(date)).path,
    getSettings: () => exposed.getSettings?.() ?? missing('getSettings'),
    setSettings: (patch) => exposed.setSettings?.(patch) ?? missing('setSettings'),
    getNote: (date) => exposed.getNote?.(date) ?? missing('getNote'),
    setNote: (date, text) => exposed.setNote?.(date, text) ?? missing('setNote'),
    saveImage: async (defaultName, pngBase64) =>
      (await (exposed.saveImage?.(defaultName, pngBase64) ?? missing('saveImage'))).path,
    quit: () => exposed.quit?.() ?? missing('quit'),
    onTick: (cb) => api.onTick(cb)
  }
}

export function screenplay(day: DayRollup): string {
  const lines = [`# ${day.date} 剧本`, '']
  for (const scene of day.scenes) {
    const label = scene.kind === 'intermission' ? '中场休息' : scene.exe
    const title = scene.title.length > 0 ? scene.title : '—'
    lines.push(
      `- ${fmtClock(scene.start)}–${fmtClock(scene.end)} · ${label} · ${title} · ${fmtDuration(scene.seconds)}`
    )
  }
  lines.push('', `题材：${day.verdict.label}。${day.verdict.note}`)
  return `${lines.join('\n')}\n`
}

/**
 * mock 的设置只存在内存里，行为与真实设置一致，便于自查与演示。
 * ?mock=error | storage | burst 是自查入口：采集错误 / 写入异常 / 密集长列表。
 */
function mockSource(): DayfilmSource {
  // ?mock=error+storage+burst 可组合：自查采集错误 / 写入异常 / 500+ 行长列表
  const modes = new Set(
    (new URLSearchParams(window.location.search).get('mock') ?? '')
      .split(/[+,\s]+/)
      .filter(Boolean)
  )
  const captureError = modes.has('error') ? '采样子进程已退出（代码 1），30 秒后重试' : null
  const storageError = modes.has('storage')
    ? '写入 days\\2026-11-22.jsonl 失败（磁盘空间不足），采样已转入内存缓冲并重试'
    : null
  const dense = modes.has('burst')
  const readonly = modes.has('readonly')
  // ?mock=sparse 让较早的几天没有采样，用来验收“点没有数据的天”
  const sparse = modes.has('sparse')
  // mock 默认给三条项目规则，周视图的故事线与主角切换才有内容
  let settings: Settings = {
    ...DEFAULT_SETTINGS,
    redactTerms: [],
    projects: [
      // 顺序有意义：命中取第一条，设计类先·排，避免被标题里的 "Dayfilm" 抢走
      { name: '设计', terms: ['figma', 'notion'] },
      { name: 'Dayfilm', terms: ['dayfilm', 'visual studio code'] },
      { name: '阅读', terms: ['mdn', 'github', '文档'] }
    ]
  }
  const notes = new Map<string, string>()

  const today = (): string => isoDate(Date.now())
  // ?mock=sparse 让本周周一到周三没有采样，用来验收“无记录”整列
  const sparseDates = sparse ? new Set(weekDates(mondayOf(today())).slice(0, 3)) : new Set<string>()
  const dayFor = (date: string): DayRollup => {
    if (sparseDates.has(date)) return buildMockDay(date, startOfDay(date))
    const end = date === today() ? Date.now() : startOfDay(date) + 22 * 3_600_000
    return buildMockDay(date, end, { dense })
  }
  const liveNow = (): LiveState =>
    buildMockLive(today(), Date.now(), {
      captureError,
      storageError,
      paused: settings.paused,
      dense
    })
  const clone = (value: Settings): Settings => ({
    ...value,
    redactTerms: [...value.redactTerms],
    projects: value.projects.map((rule) => ({ name: rule.name, terms: [...rule.terms] }))
  })

  return {
    mode: 'mock',
    listDays: async () => mockDates(Date.now()),
    getDay: async (date) => dayFor(date),
    live: async () => liveNow(),
    search: async (query) => {
      const needle = query.trim().toLowerCase()
      if (needle.length === 0) return []
      const hits: Scene[] = []
      for (const date of mockDates(Date.now())) {
        for (const scene of dayFor(date).scenes) {
          if (scene.kind !== 'shot') continue
          if (
            scene.title.toLowerCase().includes(needle) ||
            scene.exe.toLowerCase().includes(needle)
          ) {
            hits.push(scene)
          }
        }
      }
      return hits.sort((a, b) => b.start - a.start).slice(0, 200)
    },
    exportScreenplay: async (date) => {
      const name = `dayfilm-${date}.md`
      const url = URL.createObjectURL(new Blob([screenplay(dayFor(date))], { type: 'text/markdown' }))
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      return `${name}（演示环境：浏览器下载）`
    },
    getSettings: async () => clone(settings),
    setSettings: async (patch) => {
      // ?mock=readonly 用来预览保存失败路径（面板内报错、不假装成功）
      if (readonly) throw new Error('演示环境：设置只读，写入被拒绝')
      settings = clone({ ...settings, ...patch })
      return clone(settings)
    },
    getNote: async (date) => notes.get(date) ?? '',
    setNote: async (date, text) => {
      if (readonly) throw new Error('演示环境：手记只读，写入被拒绝')
      const value = text.slice(0, 200)
      // 清空就是删掉这一天的键，不写空串
      if (value.length === 0) notes.delete(date)
      else notes.set(date, value)
      return value
    },
    saveImage: async (defaultName, pngBase64) => {
      const binary = atob(pngBase64)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
      const link = document.createElement('a')
      link.href = url
      link.download = defaultName
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      return `${defaultName}（演示环境：浏览器下载）`
    },
    quit: async () => {
      // 演示环境不真的退出，界面会提示这一点
    },
    onTick: (cb) => {
      const timer = window.setInterval(() => cb(liveNow()), 2000)
      return () => window.clearInterval(timer)
    }
  }
}

export function createSource(): DayfilmSource {
  const api: DayfilmApi | undefined = typeof window === 'undefined' ? undefined : window.dayfilm
  return api ? liveSource(api) : mockSource()
}
