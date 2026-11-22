import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DayStore, localDate } from '../../src/main/store'
import type { Sample } from '../../src/shared/types'

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
