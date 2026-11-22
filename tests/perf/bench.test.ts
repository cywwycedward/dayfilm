import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DayAggregator } from '../../src/main/reel/aggregate'
import { DayCache } from '../../src/main/reel/cache'
import { buildDayRollup, searchScenes } from '../../src/main/reel'
import { DayStore, localDate } from '../../src/main/store'
import type { Sample } from '../../src/shared/types'

/**
 * 压力基准（规格 R16/R18.3）：30 天 × 5 万条采样写进临时目录，量四项指标。
 * 上限故意放宽到机器抖动可接受的程度，真实数字打印在输出里，并由主 Agent 记入性能报告。
 */
const DAYS = 30
const PER_DAY = 50_000
/** 5 万条铺满 23.6 小时 */
const STEP_MS = 1700
const APPEND_COUNT = 1000
const EXES = ['Code', 'WindowsTerminal', 'chrome', 'Slack', 'notion', 'figma']
const TITLES = ['dayfilm - Visual Studio Code', 'npm test', 'inbox', 'design review', 'notes']

const root = mkdtempSync(join(tmpdir(), 'dayfilm-perf-'))
const store = new DayStore(root)

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

function ms(value: number): string {
  return `${value.toFixed(2)} ms`
}

function mb(value: number): string {
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function heap(): number {
  return process.memoryUsage().heapUsed
}

function dayDate(index: number): string {
  return localDate(new Date(2026, 0, 1 + index, 0, 0, 0).getTime())
}

function writeDay(index: number): void {
  const start = new Date(2026, 0, 1 + index, 0, 0, 0).getTime()
  const lines = new Array<string>(PER_DAY)
  for (let position = 0; position < PER_DAY; position += 1) {
    const phase = Math.floor(position / 200)
    const idle = Math.floor(position / 2000) % 5 === 4
    const sample: Sample = {
      t: start + position * STEP_MS,
      exe: idle ? 'LockApp' : EXES[phase % EXES.length],
      title: idle ? 'Lock screen' : `${TITLES[phase % TITLES.length]} ${phase}`,
      idleMs: idle ? 90_000 : 500
    }
    lines[position] = JSON.stringify(sample)
  }
  mkdirSync(join(root, 'days'), { recursive: true })
  writeFileSync(join(root, 'days', `${dayDate(index)}.jsonl`), `${lines.join('\n')}\n`, 'utf8')
}

function synthetic(start: number, count: number): Sample[] {
  const samples: Sample[] = []
  for (let position = 0; position < count; position += 1) {
    samples.push({ t: start + position * STEP_MS, exe: EXES[position % EXES.length], title: `tail ${position}`, idleMs: 500 })
  }
  return samples
}

describe('R16 性能基线（30 天 × 5 万条）', () => {
  it(
    '打印全量/增量/检索耗时与堆占用',
    () => {
      const writeStart = Date.now()
      for (let index = 0; index < DAYS; index += 1) writeDay(index)
      const writeMs = Date.now() - writeStart

      const date = dayDate(0)
      const readStart = Date.now()
      const samples = store.readDay(date)
      const readMs = Date.now() - readStart
      expect(samples).toHaveLength(PER_DAY)
      const totalBytes = Array.from({ length: DAYS }, (_, index) => store.sizeOf(dayDate(index))).reduce((a, b) => a + b, 0)

      const now = samples[samples.length - 1].t + STEP_MS

      // 全量参考实现
      const fullRuns = 3
      const fullStart = process.hrtime.bigint()
      let full = buildDayRollup(samples, date, now)
      for (let index = 1; index < fullRuns; index += 1) full = buildDayRollup(samples, date, now)
      const fullMs = Number(process.hrtime.bigint() - fullStart) / 1e6 / fullRuns

      // 增量：先建索引，再逐条追加上千条，量均摊
      const buildStart = process.hrtime.bigint()
      const aggregator = DayAggregator.fromSamples(samples, date)
      const buildMs = Number(process.hrtime.bigint() - buildStart) / 1e6

      const tail = synthetic(now, APPEND_COUNT)
      const appendStart = process.hrtime.bigint()
      for (const sample of tail) {
        if (!aggregator.append(sample)) throw new Error('增量索引拒绝了递增采样')
        aggregator.rollup(sample.t + STEP_MS)
      }
      const appendMs = Number(process.hrtime.bigint() - appendStart) / 1e6
      const perAppendMs = appendMs / APPEND_COUNT

      expect(aggregator.rollup(now + APPEND_COUNT * STEP_MS).scenes.length).toBeGreaterThan(0)

      // 检索：走真实链路的 DayCache（冷 7 天 + 热 7 天）
      const cache = new DayCache({ load: (day) => store.readDay(day) })
      const dates = Array.from({ length: 7 }, (_, index) => dayDate(DAYS - 1 - index))
      const coldStart = process.hrtime.bigint()
      const coldHits = searchScenes('code', dates.map((day) => cache.rollup(day, now)))
      const coldMs = Number(process.hrtime.bigint() - coldStart) / 1e6
      const warmStart = process.hrtime.bigint()
      const warmHits = searchScenes('code', dates.map((day) => cache.rollup(day, now)))
      const warmMs = Number(process.hrtime.bigint() - warmStart) / 1e6
      expect(warmHits).toEqual(coldHits)

      const heapNow = heap()
      const rss = process.memoryUsage().rss

      console.log(
        [
          '',
          '=== Dayfilm R16 基准 ===',
          `设备：${cpus()[0]?.model ?? 'unknown'} / ${cpus().length} 核 / 内存 ${mb(totalmem())} / node ${process.version} / ${process.platform}`,
          `数据：${DAYS} 天 × ${PER_DAY} 条（写入 ${writeMs} ms，落盘 ${mb(totalBytes)}）`,
          `单日读取 ${PER_DAY} 条：${ms(readMs)}`,
          `全量 buildDayRollup（单日 ${PER_DAY} 条）：${ms(fullMs)}  → 场景 ${full.scenes.length} 个`,
          `增量建索引（单日 ${PER_DAY} 条）：${ms(buildMs)}`,
          `增量追加 ${APPEND_COUNT} 条（每步追加 + 取一次汇总）：合计 ${ms(appendMs)}，均摊 ${(perAppendMs * 1000).toFixed(1)} µs`,
          `跨 7 天检索（冷，含读盘与建索引）：${ms(coldMs)}，命中 ${coldHits.length} 条`,
          `跨 7 天检索（热，走缓存）：${ms(warmMs)}，命中 ${warmHits.length} 条`,
          `堆占用：${mb(heapNow)}，RSS：${mb(rss)}`,
          '=== 结束 ===',
          ''
        ].join('\n')
      )

      // 收紧到规格量级（R16）：只让机器抖动通过，不让数量级退化通过。
      // 冷检索含读盘，与其它测试并发时会被磁盘争用拖慢，门槛留足余量；
      // 真实数字以上面的打印输出为准（perf-report.md 记录的是独跑结果）。
      expect(fullMs).toBeLessThan(50)
      expect(perAppendMs).toBeLessThan(1)
      expect(coldMs).toBeLessThan(1500)
      expect(warmMs).toBeLessThan(5)
      expect(heapNow).toBeLessThan(300 * 1024 * 1024)
      expect(rss).toBeLessThan(1024 * 1024 * 1024)
    },
    240_000
  )
})
