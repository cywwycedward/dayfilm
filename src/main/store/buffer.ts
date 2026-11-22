import type { Sample } from '../../shared/types'
import { describeError } from '../errors'

export interface WriteBufferOptions {
  /** 真正落盘；抛异常表示失败 */
  write(sample: Sample): void
  /** 写入异常变化时回调；正常为 null。消息里不得出现窗口标题。 */
  onError(message: string | null): void
  /** 缓冲区上限，默认 1000 条（规格 R14.1 的取舍：宁可丢最旧也不无界增长） */
  limit?: number
  retryMs?: number
  schedule?(fn: () => void, ms: number): () => void
}

const DEFAULT_LIMIT = 1000
const DEFAULT_RETRY_MS = 5000

/**
 * 落盘缓冲：写失败时把采样留在内存里每 5 秒重试，并把错误暴露给界面。
 * 成功一次就清空缓冲与错误，因此偶发失败不会留下长期提示。
 */
export class WriteBuffer {
  private pending: Sample[] = []
  private dropped = 0
  private cancel: (() => void) | null = null
  private running = false
  private error: string | null = null
  private readonly limit: number
  private readonly retryMs: number
  private readonly schedule: (fn: () => void, ms: number) => () => void

  constructor(private readonly options: WriteBufferOptions) {
    this.limit = Math.max(1, options.limit ?? DEFAULT_LIMIT)
    this.retryMs = Math.max(1, options.retryMs ?? DEFAULT_RETRY_MS)
    this.schedule = options.schedule ?? ((fn, ms) => {
      const timer = setTimeout(fn, ms)
      return () => clearTimeout(timer)
    })
  }

  get pendingCount(): number {
    return this.pending.length
  }

  get droppedCount(): number {
    return this.dropped
  }

  get errorMessage(): string | null {
    return this.error
  }

  push(sample: Sample): void {
    this.pending.push(sample)
    if (this.pending.length > this.limit) {
      const overflow = this.pending.length - this.limit
      this.pending.splice(0, overflow)
      this.dropped += overflow
    }
    this.flush()
  }

  /** 尝试写完缓冲区；失败保留剩余部分并交给定时重试。 */
  flush(): void {
    if (this.pending.length === 0) {
      this.setError(null)
      return
    }
    let written = 0
    try {
      for (; written < this.pending.length; written += 1) this.options.write(this.pending[written])
      this.pending.length = 0
      this.dropped = 0
      this.setError(null)
    } catch (error) {
      this.pending.splice(0, written)
      this.setError(this.describe(error))
    }
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.scheduleNext()
  }

  stop(): void {
    this.running = false
    if (this.cancel) {
      this.cancel()
      this.cancel = null
    }
  }

  /** 退出前最后试一次；返回是否已全部写完。 */
  drain(): boolean {
    this.flush()
    return this.pending.length === 0
  }

  private scheduleNext(): void {
    this.cancel = this.schedule(() => {
      this.cancel = null
      this.flush()
      if (this.running) this.scheduleNext()
    }, this.retryMs)
  }

  private setError(message: string | null): void {
    if (this.error === message) return
    this.error = message
    this.options.onError(message)
  }

  private describe(error: unknown): string {
    const parts = [`写入异常（${describeError(error)}），已缓冲 ${this.pending.length} 条采样，每 ${this.retryMs / 1000} 秒重试`]
    if (this.dropped > 0) parts.push(`已丢弃最旧的 ${this.dropped} 条`)
    return parts.join('，')
  }
}
