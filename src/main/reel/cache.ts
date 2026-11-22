import type { DayRollup, Sample } from '../../shared/types'
import { DayAggregator } from './aggregate'

export interface DayCacheOptions {
  /** 从磁盘读某一天的采样 */
  load(date: string): Sample[]
  /** 只把满足条件的采样喂给聚合器（例如剔除 Dayfilm 自身窗口，规格 R1.3） */
  keep?(sample: Sample): boolean
  /** 最多驻留多少天，默认 8（检索要跨 7 天） */
  limit?: number
}

interface Entry {
  samples: Sample[]
  aggregator: DayAggregator
}

const DEFAULT_LIMIT = 8

/**
 * 按日缓存：采样数组 + 增量聚合。当日新增只走 `append`，历史日首次访问时全量建索引。
 * 是最久未用淘汰的 LRU，保证 30 天历史不会全量驻留内存（规格 R16）。
 */
export class DayCache {
  private readonly entries = new Map<string, Entry>()
  private readonly limit: number

  constructor(private readonly options: DayCacheOptions) {
    this.limit = Math.max(1, options.limit ?? DEFAULT_LIMIT)
  }

  /** 已驻留的日期，按最近使用排序（调试与测试用）。 */
  get loadedDates(): string[] {
    return [...this.entries.keys()]
  }

  /** 某日的原始采样（含被 `keep` 排除的那些，实时镜头需要看到自身窗口）。 */
  samples(date: string): Sample[] {
    return this.entry(date).samples
  }

  /** 该日最后一条采样的时间戳，用于时钟守卫。 */
  lastT(date: string): number | null {
    const samples = this.entry(date).samples
    return samples.length > 0 ? samples[samples.length - 1].t : null
  }

  append(date: string, sample: Sample): void {
    const entry = this.entry(date)
    entry.samples.push(sample)
    if (this.options.keep && !this.options.keep(sample)) return
    if (entry.aggregator.append(sample)) return
    // 时间倒退（时钟回拨漏过来了）：整体重建，保证结果与全量一致。
    entry.aggregator = this.build(date, entry.samples)
  }

  rollup(date: string, now: number): DayRollup {
    return this.entry(date).aggregator.rollup(now)
  }

  /** 丢弃缓存；不传日期表示清空。 */
  invalidate(date?: string): void {
    if (date === undefined) this.entries.clear()
    else this.entries.delete(date)
  }

  private entry(date: string): Entry {
    const cached = this.entries.get(date)
    if (cached) {
      // Map 的插入顺序即 LRU 顺序：命中后挪到末尾。
      this.entries.delete(date)
      this.entries.set(date, cached)
      return cached
    }
    const samples = this.options.load(date)
    const entry: Entry = { samples, aggregator: this.build(date, samples) }
    this.entries.set(date, entry)
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
    return entry
  }

  private build(date: string, samples: readonly Sample[]): DayAggregator {
    const keep = this.options.keep
    return DayAggregator.fromSamples(keep ? samples.filter(keep) : samples, date)
  }
}
