import { copyFileSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AUTO_EXTRA_OPTIONS,
  DEFAULT_SETTINGS,
  RETENTION_OPTIONS,
  type HudSettings,
  type ProjectRule,
  type Settings,
  type SoundSettings
} from '../../shared/settings'
import { describeError } from '../errors'

const RETENTION_VALUES: readonly number[] = RETENTION_OPTIONS.map((option) => option.value)
/** 自动花絮阈值只接受这几个值（0 = 关闭）。 */
const AUTO_EXTRA_VALUES: readonly number[] = AUTO_EXTRA_OPTIONS.map((option) => option.value)
const SOUND_MODES: readonly SoundSettings['mode'][] = ['projector', 'cuts']
const MAX_TERM_LENGTH = 64
const MAX_TERMS = 100
const MAX_PROJECTS = 20
const MAX_PROJECT_NAME = 32
const MAX_PROJECT_TERMS = 20

function normalizeRetention(value: unknown, fallback: number): number {
  return typeof value === 'number' && RETENTION_VALUES.includes(value) ? value : fallback
}

/** 自动花絮阈值：只认白名单里的秒数，其它值回落到上一份合法值。 */
function normalizeAutoExtra(value: unknown, fallback: number): number {
  return typeof value === 'number' && AUTO_EXTRA_VALUES.includes(value) ? value : fallback
}

/** 音量夹到 0..1，并保留两位小数。 */
function normalizeVolume(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100
}

/** 音效：mode 只接受 projector/cuts，volume 夹紧；不是对象时返回 null（调用方回落）。 */
function normalizeSound(value: unknown, base: SoundSettings): SoundSettings | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const mode =
    typeof record.mode === 'undefined'
      ? base.mode
      : SOUND_MODES.includes(record.mode as SoundSettings['mode'])
        ? (record.mode as SoundSettings['mode'])
        : base.mode
  return { mode, volume: normalizeVolume(record.volume, base.volume) }
}

function normalizeBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'undefined' ? fallback : Boolean(value)
}

/** trim、去空、单条 ≤64 字符、不区分大小写去重、最多 100 条；不是数组时返回 null。 */
function normalizeTerms(value: unknown, limit = MAX_TERMS): string[] | null {
  if (!Array.isArray(value)) return null
  const seen = new Set<string>()
  const terms: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const term = item.trim().slice(0, MAX_TERM_LENGTH)
    if (term.length === 0) continue
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    terms.push(term)
    if (terms.length >= limit) break
  }
  return terms
}

/**
 * 项目规则：名称 trim 后 1–32 字、同名保留第一条、关键词去空去重且最多 20 条、
 * 没有关键词的规则丢掉、整体最多 20 条。不是数组时返回 null（调用方回落到上一份值）。
 */
function normalizeProjects(value: unknown): ProjectRule[] | null {
  if (!Array.isArray(value)) return null
  const seen = new Set<string>()
  const projects: ProjectRule[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if (typeof record.name !== 'string') continue
    const name = record.name.trim().slice(0, MAX_PROJECT_NAME)
    if (name.length === 0) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    const terms = normalizeTerms(record.terms, MAX_PROJECT_TERMS)
    if (!terms || terms.length === 0) continue
    seen.add(key)
    projects.push({ name, terms })
    if (projects.length >= MAX_PROJECTS) break
  }
  // 整个数组里一条都没活下来（而不是显式传空数组）：当坏值处理，让调用方回落到上一份。
  if (projects.length === 0 && value.length > 0) return null
  return projects
}

/** HUD 坐标：缺省沿用 base；显式传了但不是有限数就当没拖过（null）。 */
function normalizeHudCoord(value: unknown, fallback: number | null): number | null {
  if (typeof value === 'undefined') return fallback
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** HUD 设置：不是对象则不接管（返回 null，调用方回落）；visible 用 Boolean()，坐标只收有限数。 */
function normalizeHud(value: unknown, base: HudSettings): HudSettings | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  return {
    visible: normalizeBool(record.visible, base.visible),
    x: normalizeHudCoord(record.x, base.x),
    y: normalizeHudCoord(record.y, base.y)
  }
}

/** 字段级回落：缺失或类型不符的字段取 base 的同名字段。 */
export function normalizeSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const record = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const terms = normalizeTerms(record.redactTerms)
  const projects = normalizeProjects(record.projects)
  const hud = normalizeHud(record.hud, base.hud)
  const sound = normalizeSound(record.sound, base.sound)
  return {
    retentionDays: normalizeRetention(record.retentionDays, base.retentionDays),
    redactTerms: terms ?? [...base.redactTerms],
    autoStart: normalizeBool(record.autoStart, base.autoStart),
    paused: normalizeBool(record.paused, base.paused),
    projects: projects ?? [...base.projects],
    hud: hud ?? { ...base.hud },
    autoExtraUnderSec: normalizeAutoExtra(record.autoExtraUnderSec, base.autoExtraUnderSec),
    sound: sound ?? { ...base.sound }
  }
}

/** `<root>/settings.json`。读时逐字段回落并写回修复结果；写时 tmp + rename 原子替换。 */
export class SettingsStore {
  private readonly file: string
  private cached: Settings | null = null

  constructor(private readonly root: string) {
    this.file = join(root, 'settings.json')
  }

  get(): Settings {
    if (this.cached) return this.cached
    let text: string | null = null
    try {
      // PowerShell 5.1 的 `Set-Content -Encoding utf8` 会带 BOM；不剥掉会解析失败、把设置静默重置。
      text = readFileSync(this.file, 'utf8').replace(/^\uFEFF/, '')
    } catch {
      text = null
    }
    let parsed: unknown = null
    let corrupt = false
    if (text !== null) {
      try {
        parsed = JSON.parse(text)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          parsed = null
          corrupt = true
        }
      } catch {
        parsed = null
        corrupt = true
      }
    }
    const settings = normalizeSettings(parsed)
    this.cached = settings
    // 损坏的文件先原样留一份：脱敏词被清空等于原本隐藏的标题从此明文落盘，不能只留个静默重置。
    if (corrupt) this.backupCorruptFile()
    // 文件缺失、损坏或字段被归一过：把修复后的结果写回，下次启动就是干净的。
    if (text === null || text.trim() !== JSON.stringify(settings)) this.writeQuietly(settings)
    return settings
  }

  /** 覆盖写之前把损坏的原文件复制一份 `settings.corrupt-<时间戳>.json`。 */
  private backupCorruptFile(): void {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    try {
      copyFileSync(this.file, join(this.root, `settings.corrupt-${stamp}.json`))
    } catch (error) {
      console.warn('[dayfilm] 损坏的设置文件未能备份', describeError(error))
    }
  }

  /** 写盘失败抛可读错误，由调用方决定怎么暴露。 */
  save(next: Settings): void {
    const normalized = normalizeSettings(next)
    const tmp = `${this.file}.tmp`
    try {
      mkdirSync(this.root, { recursive: true })
      writeFileSync(tmp, `${JSON.stringify(normalized)}\n`, 'utf8')
      renameSync(tmp, this.file)
      this.cached = normalized
    } catch (error) {
      try {
        unlinkSync(tmp)
      } catch {
        // 临时文件可能根本没写出来
      }
      throw new Error(`设置保存失败：${describeError(error)}`)
    }
  }

  /** 只接受白名单字段，返回落盘后的完整设置。 */
  update(patch: unknown): Settings {
    const current = this.get()
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return current
    const record = patch as Record<string, unknown>
    const terms = 'redactTerms' in record ? normalizeTerms(record.redactTerms) : null
    const projects = 'projects' in record ? normalizeProjects(record.projects) : null
    const hud = 'hud' in record ? normalizeHud(record.hud, current.hud) : null
    const sound = 'sound' in record ? normalizeSound(record.sound, current.sound) : null
    const next: Settings = {
      retentionDays: normalizeRetention(record.retentionDays, current.retentionDays),
      redactTerms: terms ?? current.redactTerms,
      autoStart: normalizeBool(record.autoStart, current.autoStart),
      paused: normalizeBool(record.paused, current.paused),
      projects: projects ?? current.projects,
      hud: hud ?? { ...current.hud },
      autoExtraUnderSec: normalizeAutoExtra(record.autoExtraUnderSec, current.autoExtraUnderSec),
      sound: sound ?? { ...current.sound }
    }
    this.save(next)
    return next
  }

  private writeQuietly(settings: Settings): void {
    try {
      this.save(settings)
    } catch (error) {
      // 读路径不能因为磁盘只读而启动不了；写入有错留给后续 update 暴露。
      console.warn('[dayfilm] 设置文件写回失败', describeError(error))
    }
  }
}
