import { copyFileSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describeError } from '../errors'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
/** 规格 R23.1：一句手记最多 200 字。 */
export const MAX_NOTE_CHARS = 200
const VERSION = 1

interface NotesFile {
  version: number
  notes: Record<string, string>
}

/** 按码点截断，避免把 emoji 或组合字符切成半个。 */
export function clampNote(text: string): string {
  const clean = text.replace(/\r/g, '').trim()
  return Array.from(clean).slice(0, MAX_NOTE_CHARS).join('')
}

/** `<root>/notes.json`：日期 → 一句导演手记。写盘用 tmp + rename，读坏文件时先留档。 */
export class NotesStore {
  private readonly file: string
  private cached: Record<string, string> | null = null

  constructor(private readonly root: string) {
    this.file = join(root, 'notes.json')
  }

  get(date: string): string {
    if (!DATE_PATTERN.test(date)) return ''
    return this.load()[date] ?? ''
  }

  /** 写入并返回落盘后的内容（已 trim 与截断）；空文本等于删除该天的手记。 */
  set(date: string, text: string): string {
    if (!DATE_PATTERN.test(date)) throw new Error('手记日期不合法')
    const value = clampNote(text)
    const notes = { ...this.load() }
    if (value.length === 0) delete notes[date]
    else notes[date] = value
    this.persist(notes)
    this.cached = notes
    return value
  }

  private load(): Record<string, string> {
    if (this.cached) return this.cached
    let text: string | null = null
    try {
      text = readFileSync(this.file, 'utf8').replace(/^\uFEFF/, '')
    } catch {
      text = null
    }
    let notes: Record<string, string> = {}
    let corrupt = false
    if (text !== null) {
      try {
        const parsed: unknown = JSON.parse(text)
        const record = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
        const entries = record && typeof record.notes === 'object' && record.notes !== null ? (record.notes as Record<string, unknown>) : null
        if (!entries) {
          corrupt = true
        } else {
          for (const [date, value] of Object.entries(entries)) {
            if (DATE_PATTERN.test(date) && typeof value === 'string' && value.trim().length > 0) {
              notes[date] = value
            }
          }
        }
      } catch {
        corrupt = true
      }
    }
    if (corrupt) {
      notes = {}
      this.backupCorruptFile()
    }
    this.cached = notes
    return notes
  }

  private backupCorruptFile(): void {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    try {
      copyFileSync(this.file, join(this.root, `notes.corrupt-${stamp}.json`))
    } catch (error) {
      console.warn('[dayfilm] 损坏的手记文件未能备份', describeError(error))
    }
  }

  private persist(notes: Record<string, string>): void {
    const payload: NotesFile = { version: VERSION, notes }
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
      throw new Error(`手记保存失败：${describeError(error)}`)
    }
  }
}
