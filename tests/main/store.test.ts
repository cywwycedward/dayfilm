import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { searchOutcome } from '../../src/main/reel/search'
import { cleanupExpired } from '../../src/main/retention'
import { DayStore, localDate } from '../../src/main/store'
import type { DayRollup, Sample } from '../../src/shared/types'

const DAY_MS = 86_400_000

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dayfilm-store-'))
  roots.push(root)
  return root
}

function sample(t: number, exe = 'Code', title = 'dayfilm'): Sample {
  return { t, exe, title, idleMs: 1200 }
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true })
})

describe('DayStore', () => {
  it('写入后读回一致', () => {
    const store = new DayStore(tempRoot())
    const t = new Date(2026, 10, 22, 10, 0, 0).getTime()
    const samples = [sample(t), sample(t + 2000, 'WindowsTerminal', 'npm test')]
    for (const item of samples) store.append(item)

    expect(store.readDay('2026-11-22')).toEqual(samples)
    expect(store.listDays()).toEqual(['2026-11-22'])
  })

  it('坏行与字段不符的行被跳过', () => {
    const root = tempRoot()
    const dir = join(root, 'days')
    mkdirSync(dir, { recursive: true })
    const good = sample(new Date(2026, 10, 22, 9, 0, 0).getTime())
    writeFileSync(
      join(dir, '2026-11-22.jsonl'),
      [
        JSON.stringify(good),
        '',
        '{ not json',
        '{"t":1,"exe":"Code"}',
        '{"t":"1","exe":"Code","title":"x","idleMs":0}',
        JSON.stringify(sample(good.t + 2000))
      ].join('\n'),
      'utf8'
    )

    const samples = new DayStore(root).readDay('2026-11-22')
    expect(samples).toHaveLength(2)
    expect(samples[0]).toEqual(good)
  })

  it('跨天写进不同文件，读取互不影响', () => {
    const store = new DayStore(tempRoot())
    const late = new Date(2026, 10, 22, 23, 59, 0).getTime()
    const early = new Date(2026, 10, 23, 0, 1, 0).getTime()
    store.append(sample(late))
    store.append(sample(early))

    expect(store.listDays()).toEqual(['2026-11-23', '2026-11-22'])
    expect(store.readDay('2026-11-22')).toHaveLength(1)
    expect(store.readDay('2026-11-23')).toHaveLength(1)
  })

  it('日文件是逐行 JSON，追加不覆盖既有内容', () => {
    const root = tempRoot()
    const store = new DayStore(root)
    const t = new Date(2026, 10, 22, 9, 0, 0).getTime()
    store.append(sample(t))
    store.append(sample(t + 2000))
    const text = readFileSync(join(root, 'days', '2026-11-22.jsonl'), 'utf8')
    expect(text.split('\n').filter((line) => line.length > 0)).toHaveLength(2)
  })

  it('崩溃留下的半行不会吃掉恢复后的第一条采样', () => {
    const root = tempRoot()
    const dir = join(root, 'days')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '2026-11-22.jsonl'), '{"t":123,"exe":"Co', 'utf8')

    const store = new DayStore(root)
    const item = sample(new Date(2026, 10, 22, 9, 0, 0).getTime())
    store.append(item)

    expect(store.readDay('2026-11-22')).toEqual([item])
    // 半行本身仍是坏行，只是不应该把新采样一起葬送
    expect(readFileSync(join(dir, '2026-11-22.jsonl'), 'utf8')).toContain('\n{"t":')
  })

  it('已经开始写过的文件不会多插空行', () => {
    const root = tempRoot()
    const store = new DayStore(root)
    const t = new Date(2026, 10, 22, 9, 0, 0).getTime()
    store.append(sample(t))
    store.append(sample(t + 2000))
    const text = readFileSync(join(root, 'days', '2026-11-22.jsonl'), 'utf8')
    expect(text.split('\n').filter((line) => line.length > 0)).toHaveLength(2)
    expect(text).not.toContain('\n\n')
  })

  it('listDays 只认 YYYY-MM-DD.jsonl，倒序排列', () => {
    const root = tempRoot()
    const dir = join(root, 'days')
    mkdirSync(dir, { recursive: true })
    for (const name of ['2026-11-20.jsonl', '2026-11-22.jsonl', 'notes.txt', '2026-11-21.jsonl.bak', '2026-11-21.jsonl']) {
      writeFileSync(join(dir, name), '', 'utf8')
    }
    expect(new DayStore(root).listDays()).toEqual(['2026-11-22', '2026-11-21', '2026-11-20'])
  })

  it('没有数据目录时返回空结果', () => {
    const store = new DayStore(join(tempRoot(), 'missing'))
    expect(store.listDays()).toEqual([])
    expect(store.readDay('2026-11-22')).toEqual([])
  })

  it('拒绝非法日期，不拼到目录外', () => {
    const store = new DayStore(tempRoot())
    expect(store.readDay('../etc/passwd')).toEqual([])
  })

  it('localDate 使用本地时区而非 UTC', () => {
    expect(localDate(new Date(2026, 0, 5, 0, 30, 0).getTime())).toBe('2026-01-05')
    expect(localDate(new Date(2026, 11, 31, 23, 30, 0).getTime())).toBe('2026-12-31')
  })
})

describe('保留边界与保留期内的空日期', () => {
  const NOW = new Date(2026, 10, 27, 12, 0, 0).getTime()
  const RETENTION_DAYS = 30
  // 与主进程的 keptDays() / cleanupExpired 同一口径：
  // 保留范围的下界 = 今天 − 保留天数，且那天本身还在
  const cutoff = localDate(NOW - RETENTION_DAYS * DAY_MS)

  const EMPTY: DayRollup = {
    date: '',
    firstAt: null,
    lastAt: null,
    activeMs: 0,
    idleMs: 0,
    scenes: [],
    cuts: 0,
    longestShot: null,
    topApps: [],
    verdict: { label: '长镜头', note: '', cutRate: 0 },
    featureMs: 0,
    extraMs: 0
  }

  function storeWith(dates: string[]): DayStore {
    const root = tempRoot()
    const dir = join(root, 'days')
    mkdirSync(dir, { recursive: true })
    for (const date of dates) writeFileSync(join(dir, `${date}.jsonl`), '', 'utf8')
    return new DayStore(root)
  }

  /** 保留期边界上的日期
   * （今天 − 30 天 = 10-28）与保留期内但没有文件的 11-20。 */
  const EXPIRED = localDate(NOW - (RETENTION_DAYS + 1) * DAY_MS)
  const withFiles = (): DayStore => storeWith(['2026-11-27', '2026-10-29', cutoff, EXPIRED])
  const retainedOf = (store: DayStore): string[] => store.listDays().filter((date) => date >= cutoff)

  it('保留期最后一天仍在保留范围内，再早一天已被清理', () => {
    const store = withFiles()
    const retained = retainedOf(store)
    expect(retained).toContain(cutoff)
    expect(retained).not.toContain(EXPIRED)
    // 清理器与 keptDays() 同一口径：只删保留边界之前的日文件
    expect(cleanupExpired(store, RETENTION_DAYS, NOW).removed).toEqual([EXPIRED])
  })

  it('保留期内没有日文件：只是没有命中，不是超出保留范围', () => {
    const retained = retainedOf(withFiles())
    const outcome = searchOutcome('2026-11-20', { retained: () => retained, day: () => EMPTY }, NOW)
    expect(outcome).toEqual({ hits: [], coverage: 'full', retainedFrom: cutoff })
  })

  it('保留边界之前的日期才算超出保留范围', () => {
    const retained = retainedOf(withFiles())
    const outcome = searchOutcome(EXPIRED, { retained: () => retained, day: () => EMPTY }, NOW)
    expect(outcome.coverage).toBe('expired')
    expect(outcome.retainedFrom).toBe(cutoff)
  })
})
