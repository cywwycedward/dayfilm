import type { Settings } from '../../shared/settings'
import type { Sample } from '../../shared/types'
import { redactSample } from '../redact'
import type { DayCache } from '../reel/cache'
import { acceptSampleTime, localDate } from '../store'

export interface IngestDeps {
  cache: DayCache
  settings: { get(): Settings }
  buffer: { push(sample: Sample): void }
  /** 时钟回拨被丢弃时的累计次数（调用方决定怎么节流告警） */
  onClockDrop?(count: number): void
  /** 一条采样被接受之后调用，参数是它落到的本地日期 */
  onAccepted?(date: string): void
}

export interface IngestResult {
  accepted: boolean
  date: string
}

/**
 * 主进程的采样入口，顺序是：时钟守卫 → 脱敏 → 进缓存 → 进落盘缓冲（规格 R13.3、R10.4、R14.1）。
 * 抽成不依赖 Electron 的模块，整链测试才能覆盖真正跑的那段代码。
 */
export function createIngest(deps: IngestDeps): (raw: Sample) => IngestResult {
  let clockDrops = 0
  return (raw) => {
    const date = localDate(raw.t)
    if (!acceptSampleTime(deps.cache.lastT(date), raw.t)) {
      clockDrops += 1
      deps.onClockDrop?.(clockDrops)
      return { accepted: false, date }
    }
    const sample = redactSample(raw, deps.settings.get().redactTerms)
    deps.cache.append(date, sample)
    deps.buffer.push(sample)
    deps.onAccepted?.(date)
    return { accepted: true, date }
  }
}
