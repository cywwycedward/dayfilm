import { describe, expect, it } from 'vitest'
import { buildDayRollup, orderSamples } from '../../src/main/reel'
import { DayAggregator } from '../../src/main/reel/aggregate'
import type { Sample } from '../../src/shared/types'

const DATE = '2026-11-22'
const T0 = new Date(2026, 10, 22, 9, 0, 0).getTime()
const EXES = ['Code', 'WindowsTerminal', 'chrome', 'Slack']
const TITLES = ['dayfilm', 'npm test', 'inbox', 'dayfilm']

/** 确定性 PRNG，保证失败可复现。 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]
}

/** 随机序列：乱序、重复时间戳、空闲切换、>90 秒空档、尾部未闭合的镜头。 */
function randomCase(seed: number): { samples: Sample[]; now: number } {
  const random = mulberry32(seed)
  const count = 1 + Math.floor(random() * 40)
  const samples: Sample[] = []
  let t = T0
  for (let index = 0; index < count; index += 1) {
    t += pick([0, 2000, 2000, 2000, 30000, 95000, 200000], random)
    samples.push({
      t,
      exe: pick(EXES, random),
      title: pick(TITLES, random),
      idleMs: random() < 0.25 ? 60000 + Math.floor(random() * 180000) : Math.floor(random() * 58000)
    })
  }
  for (let index = samples.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    const temp = samples[index]
    samples[index] = samples[swap]
    samples[swap] = temp
  }
  const lastT = samples.length > 0 ? Math.max(...samples.map((sample) => sample.t)) : T0
  return { samples, now: lastT + Math.floor(random() * 6000) }
}

describe('DayAggregator 与全量结果一致', () => {
  it('空输入', () => {
    expect(DayAggregator.fromSamples([], DATE).rollup(T0)).toEqual(buildDayRollup([], DATE, T0))
  })

  it('200 组随机序列（乱序、重复时间戳、空闲切换、尾部未闭合）', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const { samples, now } = randomCase(seed)
      expect(DayAggregator.fromSamples(samples, DATE).rollup(now), `seed=${seed}`).toEqual(
        buildDayRollup(samples, DATE, now)
      )
    }
  })

  it('分批追加与一次性全量一致', () => {
    for (let seed = 1; seed <= 120; seed += 1) {
      const { samples, now } = randomCase(seed)
      const ordered = orderSamples(samples)
      const split = Math.floor(ordered.length / 2)
      const aggregator = DayAggregator.fromSamples(ordered.slice(0, split), DATE)
      for (const sample of ordered.slice(split)) aggregator.append(sample)
      expect(aggregator.rollup(now), `seed=${seed}`).toEqual(buildDayRollup(samples, DATE, now))
    }
  })

  it('每次追加后重算尾部都与全量一致', () => {
    const { samples, now } = randomCase(7)
    const ordered = orderSamples(samples)
    const aggregator = new DayAggregator(DATE)
    for (const sample of ordered) {
      expect(aggregator.append(sample)).toBe(true)
      expect(aggregator.rollup(now), `t=${sample.t}`).toEqual(buildDayRollup(ordered.slice(0, ordered.indexOf(sample) + 1), DATE, now))
    }
  })

  it('剪辑子计数在全量与增量里相同，且和等于 cuts', () => {
    const samples: Sample[] = [
      { t: T0, exe: 'Code', title: 'dayfilm', idleMs: 0 },
      { t: T0 + 2000, exe: 'Code', title: 'dayfilm', idleMs: 0 },
      { t: T0 + 4000, exe: 'Code', title: 'dayfilm', idleMs: 0 },
      { t: T0 + 6000, exe: 'Code', title: 'dayfilm', idleMs: 0 },
      { t: T0 + 8000, exe: 'Code', title: 'test.ts', idleMs: 0 },
      { t: T0 + 10_000, exe: 'Code', title: 'test.ts', idleMs: 0 },
      { t: T0 + 12_000, exe: 'Slack', title: 'inbox', idleMs: 0 },
      { t: T0 + 14_000, exe: 'Slack', title: 'inbox', idleMs: 0 },
      { t: T0 + 16_000, exe: 'Slack', title: 'inbox', idleMs: 0 },
      { t: T0 + 18_000, exe: 'Slack', title: 'inbox', idleMs: 0 },
      { t: T0 + 20_000, exe: '', title: '', idleMs: 0 },
      { t: T0 + 22_000, exe: '', title: '', idleMs: 0 },
      { t: T0 + 24_000, exe: 'Code', title: 'dayfilm', idleMs: 0 },
      { t: T0 + 26_000, exe: 'Code', title: 'dayfilm', idleMs: 0 },
      { t: T0 + 28_000, exe: 'Code', title: 'dayfilm', idleMs: 0 },
      { t: T0 + 30_000, exe: 'Code', title: 'dayfilm', idleMs: 0 }
    ]
    const now = T0 + 32_000
    const full = buildDayRollup(samples, DATE, now)
    const incremental = DayAggregator.fromSamples(samples, DATE).rollup(now)

    expect(incremental).toEqual(full)
    expect(full.appCuts).toBe(2)
    expect(full.withinAppCuts).toBe(1)
    expect(full.cuts).toBe((full.appCuts ?? 0) + (full.withinAppCuts ?? 0))
  })

  it('时间不递增时拒绝追加', () => {
    const aggregator = new DayAggregator(DATE)
    expect(aggregator.append({ t: 2000, exe: 'Code', title: 'a', idleMs: 0 })).toBe(true)
    expect(aggregator.append({ t: 2000, exe: 'Code', title: 'a', idleMs: 0 })).toBe(false)
    expect(aggregator.append({ t: 1000, exe: 'Code', title: 'a', idleMs: 0 })).toBe(false)
    expect(aggregator.lastSampleT).toBe(2000)
  })
})
