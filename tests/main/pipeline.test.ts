import { afterEach, describe, expect, it } from 'vitest'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureMarkdownPath } from '../../src/main/export'
import { createIngest } from '../../src/main/ingest'
import { NotesStore } from '../../src/main/notes'
import { buildDayRollup, renderScreenplay } from '../../src/main/reel'
import { DayCache } from '../../src/main/reel/cache'
import { cleanupExpired } from '../../src/main/retention'
import { SettingsStore } from '../../src/main/settings'
import { DayStore, localDate } from '../../src/main/store'
import { WriteBuffer } from '../../src/main/store/buffer'
import type { Sample } from '../../src/shared/types'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dayfilm-pipeline-'))
  roots.push(root)
  return root
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true })
})

const T0 = new Date(2026, 10, 22, 9, 0, 0).getTime()
const DATE = localDate(T0)

function raw(t: number, exe: string, title: string): Sample {
  return { t, exe, title, idleMs: 0 }
}

/** 采集 → 脱敏 → 落盘 → 切分 → 导出，全程在临时目录里，不启动窗口。 */
describe('整链集成', () => {
  it('采样落盘前脱敏，读回后切分与导出结果一致', () => {
    const root = tempRoot()
    const settings = new SettingsStore(root)
    settings.update({ retentionDays: 7, redactTerms: ['payroll'] })
    const store = new DayStore(root)
    const cache = new DayCache({ load: (date) => store.readDay(date) })
    const errors: Array<string | null> = []
    const buffer = new WriteBuffer({ write: (item) => store.append(item), onError: (message) => errors.push(message) })

    // 用主进程真正跑的那段采样入口，而不是在这里复制一遍步骤。
    const drops: number[] = []
    const accepted: string[] = []
    const ingest = createIngest({
      cache,
      settings,
      buffer,
      onClockDrop: (count) => drops.push(count),
      onAccepted: (date) => accepted.push(date)
    })

    const incoming = [
      raw(T0, 'Code', 'dayfilm - Visual Studio Code'),
      raw(T0 + 2000, 'Code', 'dayfilm - Visual Studio Code'),
      raw(T0 + 4000, 'Chrome', 'ACME Payroll'),
      raw(T0 + 6000, 'Chrome', 'ACME Payroll'),
      // 时钟回拨：比最后一条早，必须丢弃
      raw(T0 + 3000, 'Chrome', 'ACME Payroll')
    ]
    const results = incoming.map((item) => ingest(item))

    expect(results.map((result) => result.accepted)).toEqual([true, true, true, true, false])
    expect(drops).toEqual([1])
    expect(accepted).toEqual([DATE, DATE, DATE, DATE])
    expect(buffer.pendingCount).toBe(0)
    expect(errors).toEqual([])

    // R10.4：磁盘上不得出现被隐藏的原文
    const disk = readFileSync(join(root, 'days', `${DATE}.jsonl`), 'utf8')
    expect(disk).not.toContain('ACME Payroll')
    expect(disk).toContain('[已隐藏]')
    expect(disk.trimEnd().split('\n')).toHaveLength(4)

    const rollup = cache.rollup(DATE, T0 + 8000)
    expect(rollup).toEqual(buildDayRollup(store.readDay(DATE), DATE, T0 + 8000))
    expect(rollup.scenes.map((scene) => scene.exe)).toEqual(['Code', 'Chrome'])
    expect(rollup.cuts).toBe(1)

    const screenplay = renderScreenplay(rollup)
    expect(screenplay).toContain(`# ${DATE} · Dayfilm 剧本`)
    expect(screenplay).toContain('[已隐藏]')
    expect(screenplay).not.toContain('ACME')
    expect(screenplay.split('\n').filter((line) => line.startsWith('- ['))).toHaveLength(2)

    // 手记与项目参与导出（R23.4 / R26.1），走真实的手记存储
    const notes = new NotesStore(root)
    notes.set(DATE, '收尾不错')
    const withMeta = renderScreenplay(rollup, { note: notes.get(DATE), projects: [{ name: '编码', terms: ['code'] }] })
    expect(withMeta).toContain('> 导演手记：收尾不错')
    expect(withMeta).toContain('项目：编码 1 分钟')
    expect(ensureMarkdownPath('out/dayfilm.txt').endsWith('.md')).toBe(true)

    expect(store.listDays()).toEqual([DATE])
    // 保留期内的数据不会被清理
    expect(cleanupExpired(store, 7, T0 + 8000)).toEqual({ removed: [], errors: [] })
  })

  it('坏行与半行不影响整天读取', () => {
    const root = tempRoot()
    const store = new DayStore(root)
    store.append(raw(T0, 'Code', 'dayfilm'))
    // 模拟进程被强杀时的尾部半行
    appendFileSync(join(root, 'days', `${DATE}.jsonl`), '{"t":123,"exe":"Code","ti', 'utf8')
    expect(store.readDay(DATE)).toEqual([raw(T0, 'Code', 'dayfilm')])
  })
})
