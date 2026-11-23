import { copyFileSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SceneMark } from '../../shared/types'
import { describeError } from '../errors'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const VERSION = 1

/** 一天的标记：镜头开始时刻（毫秒字符串）→ 标记。用开始时刻而不是镜号，因为镜号会随新数据变动。 */
export type DayMarks = Record<string, SceneMark>

interface MarksFile {
  version: number
  days: Record<string, DayMarks>
}

export function isSceneMark(value: unknown): value is SceneMark {
  return value === 'feature' || value === 'extra'
}

/** `<root>/marks.json`：导演剪辑版标记。写盘用 tmp + rename，读坏文件时先留档。 */
export class MarksStore {
  private readonly file: string
  private cached: Record<string, DayMarks> | null = null

  constructor(private readonly root: string) {
    this.file = join(root, 'marks.json')
  }

  /** 某日的标记集合；没有记录时是空对象。 */
  get(date: string): DayMarks {
    if (!DATE_PATTERN.test(date)) return {}
    return this.load()[date] ?? {}
  }

  /** 写入或清除某个镜头的标记（`null` 表示清除），返回该日最新的标记集合。 */
  set(date: string, startMs: number, mark: SceneMark | null): DayMarks {
    if (!DATE_PATTERN.test(date)) throw new Error('标记日期不合法')
    if (typeof startMs !== 'number' || !Number.isFinite(startMs)) throw new Error('标记的镜头时刻不合法')
    if (mark !== null && !isSceneMark(mark)) throw new Error('标记类型不合法')

    const days = { ...this.load() }
    const key = String(Math.trunc(startMs))
    const day: DayMarks = { ...(days[date] ?? {}) }
    if (mark === null) delete day[key]
    else day[key] = mark
    // 空的日子不留键，文件不会越滚越大
    if (Object.keys(day).length === 0) delete days[date]
    else days[date] = day

    this.persist(days)
    this.cached = days
    return day
  }

  private load(): Record<string, DayMarks> {
    if (this.cached) return this.cached
    let text: string | null = null
    try {
      text = readFileSync(this.file, 'utf8').replace(/^\uFEFF/, '')
    } catch {
      text = null
    }

    let days: Record<string, DayMarks> = {}
    let corrupt = false
    if (text !== null) {
      try {
        const parsed: unknown = JSON.parse(text)
        const record =
          typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null
        const rawDays =
          record && typeof record.days === 'object' && record.days !== null ? (record.days as Record<string, unknown>) : null
        if (!rawDays) {
          corrupt = true
        } else {
          for (const [date, value] of Object.entries(rawDays)) {
            if (!DATE_PATTERN.test(date) || typeof value !== 'object' || value === null || Array.isArray(value)) continue
            const day: DayMarks = {}
            for (const [start, mark] of Object.entries(value as Record<string, unknown>)) {
              if (!/^\d+$/.test(start) || !isSceneMark(mark)) continue
              day[start] = mark
            }
            if (Object.keys(day).length > 0) days[date] = day
          }
        }
      } catch {
        corrupt = true
      }
    }

    if (corrupt) {
      days = {}
      this.backupCorruptFile()
    }
    this.cached = days
    return days
  }

  private backupCorruptFile(): void {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    try {
      copyFileSync(this.file, join(this.root, `marks.corrupt-${stamp}.json`))
    } catch (error) {
      console.warn('[dayfilm] 损坏的标记文件未能备份', describeError(error))
    }
  }

  private persist(days: Record<string, DayMarks>): void {
    const payload: MarksFile = { version: VERSION, days }
    const tmp = `${this.file}.tmp`
    try {
      mkdirSync(this.root, { recursive: true })
      writeFileSync(tmp, `${JSON.stringify(payload)}\n`, 'utf8')
      renameSync(tmp, this.file)
    } catch (error) {
      try {
        unlinkSync(tmp)
      } catch {
        // 临时文件可能根本没写出来
      }
      throw new Error(`标记保存失败：${describeError(error)}`)
    }
  }
}
