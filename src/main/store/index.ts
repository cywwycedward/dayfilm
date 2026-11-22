import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { Sample } from '../../shared/types'

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DAY_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.jsonl$/

/** 时钟守卫：新采样必须严格晚于当日最后一条，否则丢弃（规格 R13.3）。 */
export function acceptSampleTime(lastT: number | null, t: number): boolean {
  return lastT === null || t > lastT
}

/** 本地日期字符串。不能用 toISOString()：那是 UTC 日期，会把凌晨的采样写到前一天。 */
export function localDate(ms: number): string {
  const date = new Date(ms)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function isSample(value: unknown): value is Sample {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.t === 'number' &&
    Number.isFinite(record.t) &&
    typeof record.exe === 'string' &&
    typeof record.title === 'string' &&
    typeof record.idleMs === 'number' &&
    Number.isFinite(record.idleMs)
  )
}

/** 按日追加的 JSONL 存储。root 是 userData 目录，日文件在它下面的 days/。 */
export class DayStore {
  private readonly dir: string
  private ready = false
  /** 每个日文件当前是否以换行结尾；每天只查一次，之后靠自己的写入维护。 */
  private readonly lineStart = new Map<string, boolean>()

  constructor(root: string) {
    this.dir = join(root, 'days')
  }

  append(sample: Sample): void {
    if (!this.ready) {
      mkdirSync(this.dir, { recursive: true })
      this.ready = true
    }
    const date = localDate(sample.t)
    const file = join(this.dir, `${date}.jsonl`)
    // 崩溃留下的半行会与下一条粘成一条非法 JSON：先补齐换行，别把恢复后的第一条也报销了。
    const prefix = this.startsOnNewLine(date, file) ? '' : '\n'
    appendFileSync(file, `${prefix}${JSON.stringify(sample)}\n`, 'utf8')
    this.lineStart.set(date, true)
  }

  private startsOnNewLine(date: string, file: string): boolean {
    const cached = this.lineStart.get(date)
    if (cached !== undefined) return cached
    let endsWithNewline = true
    try {
      const size = statSync(file).size
      if (size > 0) {
        const buffer = Buffer.alloc(1)
        const handle = openSync(file, 'r')
        try {
          readSync(handle, buffer, 0, 1, size - 1)
          endsWithNewline = buffer[0] === 0x0a
        } finally {
          closeSync(handle)
        }
      }
    } catch {
      // 文件还不存在（或读不到）：直接追加，交给 appendFileSync 自己报错
      endsWithNewline = true
    }
    this.lineStart.set(date, endsWithNewline)
    return endsWithNewline
  }

  /** 该日日文件的字节数；文件不存在返回 0。 */
  sizeOf(date: string): number {
    if (!DAY_PATTERN.test(date)) return 0
    try {
      return statSync(join(this.dir, `${date}.jsonl`)).size
    } catch {
      return 0
    }
  }

  /** 删除某日文件；失败抛出，由调用方决定是否暴露（保留期清理需要逐日收集错误）。 */
  removeDay(date: string): void {
    if (!DAY_PATTERN.test(date)) throw new Error('日期不合法')
    unlinkSync(join(this.dir, `${date}.jsonl`))
    this.lineStart.delete(date)
  }

  readDay(date: string): Sample[] {
    // date 会拼进路径；非法日期直接当空日处理，避免跨目录读取。
    if (!DAY_PATTERN.test(date)) return []
    let text: string
    try {
      text = readFileSync(join(this.dir, `${date}.jsonl`), 'utf8')
    } catch {
      return []
    }
    const samples: Sample[] = []
    for (const line of text.split('\n')) {
      if (line.trim().length === 0) continue
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch {
        continue
      }
      if (isSample(value)) samples.push(value)
    }
    return samples
  }

  /** 已有数据的日期，倒序。 */
  listDays(): string[] {
    let names: string[]
    try {
      names = readdirSync(this.dir)
    } catch {
      return []
    }
    return names
      .map((name) => DAY_FILE_PATTERN.exec(name)?.[1])
      .filter((date): date is string => date !== undefined)
      .sort()
      .reverse()
  }
}
