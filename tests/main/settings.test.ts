import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, RETENTION_OPTIONS } from '../../src/shared/settings'
import { SettingsStore, normalizeSettings } from '../../src/main/settings'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dayfilm-settings-'))
  roots.push(root)
  return root
}

function writeSettings(root: string, content: string): void {
  writeFileSync(join(root, 'settings.json'), content, 'utf8')
}

function readSettings(root: string): unknown {
  return JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8'))
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true })
})

describe('SettingsStore 读取', () => {
  it('文件缺失时用默认值并把它写回', () => {
    const root = tempRoot()
    expect(new SettingsStore(root).get()).toEqual(DEFAULT_SETTINGS)
    expect(readSettings(root)).toEqual(DEFAULT_SETTINGS)
  })

  it('坏文件整体回落后写回修复结果', () => {
    const root = tempRoot()
    writeSettings(root, '{ not json')
    const store = new SettingsStore(root)
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    expect(readSettings(root)).toEqual(DEFAULT_SETTINGS)
  })

  it('单字段类型不符只回落该字段', () => {
    const root = tempRoot()
    writeSettings(root, JSON.stringify({ retentionDays: 45, redactTerms: 'x', paused: true }))
    expect(new SettingsStore(root).get()).toEqual({
      retentionDays: DEFAULT_SETTINGS.retentionDays,
      redactTerms: DEFAULT_SETTINGS.redactTerms,
      autoStart: DEFAULT_SETTINGS.autoStart,
      paused: true,
      projects: [],
      hud: DEFAULT_SETTINGS.hud,
      autoExtraUnderSec: DEFAULT_SETTINGS.autoExtraUnderSec,
      sound: DEFAULT_SETTINGS.sound
    })
  })

  it('归一后的值会被写回磁盘（下次启动就是干净的）', () => {
    const root = tempRoot()
    writeSettings(root, JSON.stringify({ retentionDays: 90, redactTerms: ['  Bank  ', 'bank', ''] }))
    new SettingsStore(root).get()
    expect(readSettings(root)).toEqual({ ...DEFAULT_SETTINGS, retentionDays: 90, redactTerms: ['Bank'] })
  })

  it('损坏的文件在覆盖前留一份备份', () => {
    const root = tempRoot()
    writeSettings(root, '{ not json')
    expect(new SettingsStore(root).get()).toEqual(DEFAULT_SETTINGS)

    const backups = readdirSync(root).filter((name) => /^settings\.corrupt-.+\.json$/.test(name))
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(root, backups[0]), 'utf8')).toBe('{ not json')
    expect(readSettings(root)).toEqual(DEFAULT_SETTINGS)

    // 再启动一次不会再产生备份（文件已经被修好）
    new SettingsStore(root).get()
    expect(readdirSync(root).filter((name) => name.startsWith('settings.corrupt-'))).toHaveLength(1)
  })

  it('非对象的 JSON 也算损坏并备份', () => {
    const root = tempRoot()
    writeSettings(root, '[]')
    expect(new SettingsStore(root).get()).toEqual(DEFAULT_SETTINGS)
    expect(readdirSync(root).filter((name) => name.startsWith('settings.corrupt-'))).toHaveLength(1)
  })

  it('字段只是被归一过时不产生备份', () => {
    const root = tempRoot()
    writeSettings(root, JSON.stringify({ retentionDays: 45 }))
    new SettingsStore(root).get()
    expect(readdirSync(root).filter((name) => name.startsWith('settings.corrupt-'))).toHaveLength(0)
  })

  it('带 UTF-8 BOM 的文件也能读，不会把设置静默重置', () => {    const root = tempRoot()
    writeSettings(root, `\uFEFF${JSON.stringify({ retentionDays: 7, paused: true })}`)
    expect(new SettingsStore(root).get()).toEqual({ ...DEFAULT_SETTINGS, retentionDays: 7, paused: true })
  })
})

describe('normalizeSettings', () => {
  it('retentionDays 只接受白名单值', () => {
    expect(RETENTION_OPTIONS.map((option) => option.value).sort((a, b) => a - b)).toEqual([0, 7, 30, 90, 365])
    expect(normalizeSettings({ retentionDays: 0 }).retentionDays).toBe(0)
    expect(normalizeSettings({ retentionDays: 7 }).retentionDays).toBe(7)
    expect(normalizeSettings({ retentionDays: 5 }).retentionDays).toBe(DEFAULT_SETTINGS.retentionDays)
    expect(normalizeSettings({ retentionDays: '30' }).retentionDays).toBe(DEFAULT_SETTINGS.retentionDays)
  })

  it('关键词 trim、去空、去重、截断', () => {
    const terms = normalizeSettings({
      redactTerms: ['  Bank ', '', '   ', 'bank', 'BANK', 'x'.repeat(200), 42, null]
    }).redactTerms
    expect(terms).toEqual(['Bank', 'x'.repeat(64)])
  })

  it('关键词最多 100 条', () => {
    const terms = Array.from({ length: 150 }, (_, index) => `term-${index}`)
    expect(normalizeSettings({ redactTerms: terms }).redactTerms).toHaveLength(100)
  })

  it('布尔按 Boolean() 归一', () => {
    expect(normalizeSettings({ autoStart: 'yes' }).autoStart).toBe(true)
    expect(normalizeSettings({ paused: 0 }).paused).toBe(false)
    expect(normalizeSettings({}).autoStart).toBe(DEFAULT_SETTINGS.autoStart)
  })

  it('返回的设置不共享默认值的数组', () => {
    const settings = normalizeSettings({})
    settings.redactTerms.push('mine')
    settings.projects.push({ name: 'x', terms: ['y'] })
    settings.hud.x = 1
    expect(DEFAULT_SETTINGS.redactTerms).toEqual([])
    expect(DEFAULT_SETTINGS.projects).toEqual([])
    expect(DEFAULT_SETTINGS.hud).toEqual({ visible: true, x: null, y: null })
  })

  it('hud 字段归一：visible 用 Boolean()，坐标只收有限数', () => {
    expect(normalizeSettings({}).hud).toEqual({ visible: true, x: null, y: null })
    expect(normalizeSettings({ hud: { visible: false, x: 100, y: 200 } }).hud).toEqual({ visible: false, x: 100, y: 200 })
    expect(normalizeSettings({ hud: { visible: 'yes' } }).hud.visible).toBe(true)
    expect(normalizeSettings({ hud: { x: Number.NaN, y: Number.POSITIVE_INFINITY } }).hud).toEqual({
      visible: true,
      x: null,
      y: null
    })
    expect(normalizeSettings({ hud: { x: '12' } }).hud.x).toBeNull()
    // 不是对象就不接管，回落默认
    expect(normalizeSettings({ hud: 'on' }).hud).toEqual({ visible: true, x: null, y: null })
  })

  it('hud 补丁只改传了的字段，没传的保留原值', () => {
    const store = new SettingsStore(tempRoot())
    store.update({ hud: { visible: false, x: 300, y: 200 } })
    expect(store.update({ hud: { visible: true } }).hud).toEqual({ visible: true, x: 300, y: 200 })
    // 显式传了非法坐标就当没拖过
    expect(store.update({ hud: { x: 'nope' } }).hud).toEqual({ visible: true, x: null, y: 200 })
    expect(store.update({ paused: true }).hud).toEqual({ visible: true, x: null, y: 200 })
  })
})

describe('projects 归一', () => {
  it('超长名称截到 32 字', () => {
    const projects = normalizeSettings({ projects: [{ name: `  ${'x'.repeat(50)}  `, terms: ['a'] }] }).projects
    expect(projects).toHaveLength(1)
    expect(projects[0].name).toBe('x'.repeat(32))
  })

  it('关键词为空或全是空白的规则丢掉', () => {
    expect(
      normalizeSettings({
        projects: [
          { name: 'A', terms: [] },
          { name: 'B', terms: ['', '   '] },
          { name: 'C', terms: ['ok'] }
        ]
      }).projects
    ).toEqual([{ name: 'C', terms: ['ok'] }])
  })

  it('项目名重复时保留第一条', () => {
    expect(normalizeSettings({ projects: [{ name: 'A', terms: ['x'] }, { name: ' a ', terms: ['y'] }] }).projects).toEqual([
      { name: 'A', terms: ['x'] }
    ])
  })

  it('最多 20 条', () => {
    const many = Array.from({ length: 25 }, (_, index) => ({ name: `P${index}`, terms: ['t'] }))
    expect(normalizeSettings({ projects: many }).projects).toHaveLength(20)
  })

  it('每条最多 20 个关键词，单条 ≤ 64 字，去重（不区分大小写）', () => {
    const terms = Array.from({ length: 30 }, (_, index) => `t${index}`)
    terms.push('T0')
    const projects = normalizeSettings({ projects: [{ name: 'P', terms }] }).projects
    expect(projects[0].terms).toHaveLength(20)
    expect(projects[0].terms[0]).toBe('t0')

    const long = normalizeSettings({ projects: [{ name: 'P', terms: ['z'.repeat(100)] }] }).projects
    expect(long[0].terms[0]).toHaveLength(64)
  })

  it('类型错误回落，不是清空全部', () => {
    const store = new SettingsStore(tempRoot())
    const saved = store.update({ projects: [{ name: 'A', terms: ['x'] }] })
    expect(saved.projects).toHaveLength(1)
    expect(store.update({ projects: 'nope' }).projects).toEqual(saved.projects)
    expect(store.update({ projects: [{ name: 42 }] }).projects).toEqual(saved.projects)
    expect(store.update({ paused: true }).projects).toEqual(saved.projects)
    expect(store.update({ projects: [] }).projects).toEqual([])
  })

  it('文件里的坏 projects 回落为默认空', () => {
    const root = tempRoot()
    writeSettings(root, JSON.stringify({ projects: [{ name: 'A' }] }))
    expect(new SettingsStore(root).get().projects).toEqual([])
  })
})

describe('SettingsStore 保存', () => {
  it('update 只接受白名单字段并返回完整设置', () => {
    const root = tempRoot()
    const store = new SettingsStore(root)
    const next = store.update({ retentionDays: 90, redactTerms: [' Payroll '], autoStart: true, bogus: 'ignored' })
    expect(next).toEqual({
      retentionDays: 90,
      redactTerms: ['Payroll'],
      autoStart: true,
      paused: false,
      projects: [],
      hud: DEFAULT_SETTINGS.hud,
      autoExtraUnderSec: DEFAULT_SETTINGS.autoExtraUnderSec,
      sound: DEFAULT_SETTINGS.sound
    })
    expect(Object.keys(next).sort()).toEqual([
      'autoExtraUnderSec',
      'autoStart',
      'hud',
      'paused',
      'projects',
      'redactTerms',
      'retentionDays',
      'sound'
    ])
    expect(new SettingsStore(root).get()).toEqual(next)
  })

  it('update 里的非法值保持原值', () => {
    const store = new SettingsStore(tempRoot())
    store.update({ retentionDays: 7 })
    expect(store.update({ retentionDays: 11 }).retentionDays).toBe(7)
    expect(store.update({ retentionDays: 'x' }).retentionDays).toBe(7)
  })

  it('原子写成功时不留临时文件', () => {
    const root = tempRoot()
    new SettingsStore(root).update({ paused: true })
    expect(existsSync(join(root, 'settings.json'))).toBe(true)
    expect(existsSync(join(root, 'settings.json.tmp'))).toBe(false)
  })

  it('写失败抛出可读错误且清理临时文件', () => {
    const root = tempRoot()
    // 让 settings.json 是个目录：rename 覆盖必然失败
    mkdirSync(join(root, 'settings.json'), { recursive: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = new SettingsStore(root)
    expect(() => store.update({ paused: true })).toThrow(/设置保存失败/)
    expect(existsSync(join(root, 'settings.json.tmp'))).toBe(false)
    warn.mockRestore()
  })
})

describe('autoExtraUnderSec 归一（v2.6）', () => {
  it('只接受 0 / 3 / 10 / 30', () => {
    for (const value of [0, 3, 10, 30]) {
      expect(normalizeSettings({ autoExtraUnderSec: value }).autoExtraUnderSec).toBe(value)
    }
    for (const value of [1, 5, 60, -3, '10', null, Number.NaN]) {
      expect(normalizeSettings({ autoExtraUnderSec: value }).autoExtraUnderSec, String(value)).toBe(
        DEFAULT_SETTINGS.autoExtraUnderSec
      )
    }
  })

  it('update 里非法值回落到上一份合法值', () => {
    const store = new SettingsStore(tempRoot())
    expect(store.update({ autoExtraUnderSec: 10 }).autoExtraUnderSec).toBe(10)
    expect(store.update({ autoExtraUnderSec: 7 }).autoExtraUnderSec).toBe(10)
    expect(store.update({ autoExtraUnderSec: 'lots' }).autoExtraUnderSec).toBe(10)
    expect(store.update({ autoExtraUnderSec: 30 }).autoExtraUnderSec).toBe(30)
  })
})

describe('sound 归一（v2.6）', () => {
  it('mode 只接受 projector / cuts，其它值回落', () => {
    expect(normalizeSettings({ sound: { mode: 'cuts', volume: 0.5 } }).sound).toEqual({ mode: 'cuts', volume: 0.5 })
    expect(normalizeSettings({ sound: { mode: 'loud', volume: 0.5 } }).sound.mode).toBe(DEFAULT_SETTINGS.sound.mode)
    expect(normalizeSettings({ sound: { mode: 42 } }).sound.mode).toBe(DEFAULT_SETTINGS.sound.mode)
  })

  it('volume 夹到 0..1 并保留两位小数', () => {
    expect(normalizeSettings({ sound: { volume: 2 } }).sound.volume).toBe(1)
    expect(normalizeSettings({ sound: { volume: -1 } }).sound.volume).toBe(0)
    expect(normalizeSettings({ sound: { volume: 0.3456 } }).sound.volume).toBe(0.35)
    expect(normalizeSettings({ sound: { volume: Number.NaN } }).sound.volume).toBe(DEFAULT_SETTINGS.sound.volume)
    expect(normalizeSettings({ sound: { volume: '0.5' } }).sound.volume).toBe(DEFAULT_SETTINGS.sound.volume)
  })

  it('缺字段保留上一份；不是对象则整体回落', () => {
    const store = new SettingsStore(tempRoot())
    store.update({ sound: { mode: 'cuts', volume: 0.8 } })
    // 只改音量，模式保留
    expect(store.update({ sound: { volume: 0.2 } }).sound).toEqual({ mode: 'cuts', volume: 0.2 })
    // 坏值整体回落
    expect(store.update({ sound: 'off' }).sound).toEqual({ mode: 'cuts', volume: 0.2 })
    expect(store.update({ paused: true }).sound).toEqual({ mode: 'cuts', volume: 0.2 })
  })

  it('默认值是 projector + 0.35', () => {
    expect(normalizeSettings({}).sound).toEqual({ mode: 'projector', volume: 0.35 })
  })
})
