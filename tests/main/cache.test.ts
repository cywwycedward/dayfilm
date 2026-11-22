import { describe, expect, it } from 'vitest'
import { buildDayRollup } from '../../src/main/reel'
import { DayCache } from '../../src/main/reel/cache'
import type { Sample } from '../../src/shared/types'

const T0 = new Date(2026, 10, 22, 9, 0, 0).getTime()
const DAY_MS = 86_400_000

function sample(t: number, exe = 'Code', title = 'dayfilm', idleMs = 0): Sample {
  return { t, exe, title, idleMs }
}

function daySamples(date: string, count = 4): Sample[] {
  const start = new Date(`${date}T09:00:00`).getTime() || T0
  return Array.from({ length: count }, (_, index) => sample(start + index * 2000))
}

describe('DayCache', () => {
  it('按需加载并复用聚合结果', () => {
    let loads = 0
    const cache = new DayCache({
      load: (date) => {
        loads += 1
        return daySamples(date)
      }
    })
    const first = cache.rollup('2026-11-22', T0 + 30_000)
    expect(loads).toBe(1)
    expect(first).toEqual(buildDayRollup(daySamples('2026-11-22'), '2026-11-22', T0 + 30_000))
    cache.rollup('2026-11-22', T0 + 30_000)
    expect(loads).toBe(1)
  })

  it('LRU 最多驻留 8 天（可配）', () => {
    const cache = new DayCache({ load: () => [], limit: 3 })
    for (const date of ['2026-11-01', '2026-11-02', '2026-11-03']) cache.rollup(date, T0)
    expect(cache.loadedDates).toEqual(['2026-11-01', '2026-11-02', '2026-11-03'])

    cache.rollup('2026-11-04', T0)
    expect(cache.loadedDates).toEqual(['2026-11-02', '2026-11-03', '2026-11-04'])

    // 命中会刷新使用顺序：02 变成最近用过，下一轮淘汰 03
    cache.rollup('2026-11-02', T0)
    cache.rollup('2026-11-05', T0)
    expect(cache.loadedDates).toEqual(['2026-11-04', '2026-11-02', '2026-11-05'])
  })

  it('keep 过滤只影响汇总，原始采样仍可取', () => {
    const date = '2026-11-22'
    const samples = [sample(T0), sample(T0 + 2000), sample(T0 + 4000, 'electron', 'Dayfilm'), sample(T0 + 6000)]
    const cache = new DayCache({ load: () => samples, keep: (item) => item.exe !== 'electron' })

    expect(cache.samples(date)).toHaveLength(4)
    const rollup = cache.rollup(date, T0 + 8000)
    const filtered = samples.filter((item) => item.exe !== 'electron')
    expect(rollup).toEqual(buildDayRollup(filtered, date, T0 + 8000))
    expect(rollup.scenes.map((scene) => scene.exe)).toEqual(['Code'])
  })

  it('追加采样后与全量一致', () => {
    const date = '2026-11-22'
    const samples = [sample(T0), sample(T0 + 2000)]
    const cache = new DayCache({ load: () => samples })
    cache.append(date, sample(T0 + 4000, 'Slack', 'inbox'))
    cache.append(date, sample(T0 + 6000, 'Slack', 'inbox'))
    const all = [sample(T0), sample(T0 + 2000), sample(T0 + 4000, 'Slack', 'inbox'), sample(T0 + 6000, 'Slack', 'inbox')]
    expect(cache.rollup(date, T0 + 8000)).toEqual(buildDayRollup(all, date, T0 + 8000))
  })

  it('时间倒退的追加会整体重建，结果仍与全量一致', () => {
    const date = '2026-11-22'
    const samples = [sample(T0), sample(T0 + 2000), sample(T0 + 4000)]
    const cache = new DayCache({ load: () => samples })
    cache.append(date, sample(T0 + 3000, 'Slack', 'inbox'))
    const all = [...samples, sample(T0 + 3000, 'Slack', 'inbox')]
    expect(cache.rollup(date, T0 + 6000)).toEqual(buildDayRollup(all, date, T0 + 6000))
  })

  it('lastT 取最后一条原始采样', () => {
    const date = '2026-11-22'
    const cache = new DayCache({ load: () => [sample(T0), sample(T0 + 2000)] })
    expect(cache.lastT(date)).toBe(T0 + 2000)
    cache.append(date, sample(T0 + 4000))
    expect(cache.lastT(date)).toBe(T0 + 4000)
    expect(new DayCache({ load: () => [] }).lastT(date)).toBeNull()
  })

  it('invalidate 丢弃单日或全部', () => {
    const cache = new DayCache({ load: (date) => daySamples(date) })
    cache.rollup('2026-11-22', T0)
    cache.rollup('2026-11-23', T0)
    cache.invalidate('2026-11-22')
    expect(cache.loadedDates).toEqual(['2026-11-23'])
    cache.invalidate()
    expect(cache.loadedDates).toEqual([])
  })

  it('跨天采样互不影响', () => {
    const cache = new DayCache({ load: () => [] })
    const late = new Date(2026, 10, 22, 23, 59, 0).getTime()
    cache.append('2026-11-22', sample(late))
    cache.append('2026-11-22', sample(late + 2000))
    cache.append('2026-11-23', sample(late + DAY_MS - 1000))
    cache.append('2026-11-23', sample(late + DAY_MS + 1000))
    const before = cache.rollup('2026-11-22', late + 120_000)
    const after = cache.rollup('2026-11-23', late + DAY_MS + 6000)
    expect(before.scenes).toHaveLength(1)
    expect(before.scenes[0].end).toBeLessThan(late + DAY_MS)
    expect(after.scenes).toHaveLength(1)
    expect(after.scenes[0].start).toBeGreaterThan(late + DAY_MS - 2000)
  })
})
