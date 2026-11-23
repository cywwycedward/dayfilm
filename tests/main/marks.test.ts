import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MarksStore, isSceneMark } from '../../src/main/marks'

const DATE = '2026-11-23'
const START = new Date(2026, 10, 23, 9, 0, 0).getTime()
const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dayfilm-marks-'))
  roots.push(root)
  return root
}

function readFile(root: string): { version: number; days: Record<string, Record<string, string>> } {
  return JSON.parse(readFileSync(join(root, 'marks.json'), 'utf8'))
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true })
})

describe('isSceneMark', () => {
  it('只认 feature / extra', () => {
    expect(isSceneMark('feature')).toBe(true)
    expect(isSceneMark('extra')).toBe(true)
    expect(isSceneMark('shot')).toBe(false)
    expect(isSceneMark(null)).toBe(false)
    expect(isSceneMark(1)).toBe(false)
  })
})

describe('MarksStore', () => {
  it('写入后读回，键是镜头开始时刻的毫秒字符串', () => {
    const root = tempRoot()
    const store = new MarksStore(root)
    expect(store.set(DATE, START, 'extra')).toEqual({ [String(START)]: 'extra' })
    expect(store.get(DATE)).toEqual({ [String(START)]: 'extra' })
    expect(readFile(root)).toEqual({ version: 1, days: { [DATE]: { [String(START)]: 'extra' } } })
    expect(new MarksStore(root).get(DATE)).toEqual({ [String(START)]: 'extra' })
  })

  it('同一天多个镜头互不影响，不同天分开存', () => {
    const store = new MarksStore(tempRoot())
    store.set(DATE, START, 'extra')
    store.set(DATE, START + 60_000, 'feature')
    store.set('2026-11-22', START, 'feature')
    expect(store.get(DATE)).toEqual({ [String(START)]: 'extra', [String(START + 60_000)]: 'feature' })
    expect(store.get('2026-11-22')).toEqual({ [String(START)]: 'feature' })
    expect(store.get('2026-11-20')).toEqual({})
  })

  it('mark 为 null 清除该键；清空后不留空的日子', () => {
    const root = tempRoot()
    const store = new MarksStore(root)
    store.set(DATE, START, 'extra')
    expect(store.set(DATE, START, null)).toEqual({})
    expect(store.get(DATE)).toEqual({})
    expect(readFile(root).days).toEqual({})
  })

  it('非法日期 / 非法时刻 / 非法 mark 都抛可读错误', () => {
    const store = new MarksStore(tempRoot())
    expect(() => store.set('yesterday', START, 'extra')).toThrow(/标记日期不合法/)
    expect(() => store.set(DATE, Number.NaN, 'extra')).toThrow(/镜头时刻不合法/)
    expect(() => store.set(DATE, START, 'shot' as never)).toThrow(/标记类型不合法/)
    expect(store.get('yesterday')).toEqual({})
  })

  it('坏文件按空集合处理，并留档原文件', () => {
    const root = tempRoot()
    writeFileSync(join(root, 'marks.json'), '{ not json', 'utf8')
    const store = new MarksStore(root)
    expect(store.get(DATE)).toEqual({})

    const backups = readdirSync(root).filter((name) => /^marks\.corrupt-.+\.json$/.test(name))
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(root, backups[0]), 'utf8')).toBe('{ not json')

    store.set(DATE, START, 'extra')
    expect(readFile(root)).toEqual({ version: 1, days: { [DATE]: { [String(START)]: 'extra' } } })
    expect(readdirSync(root).filter((name) => name.startsWith('marks.corrupt-'))).toHaveLength(1)
  })

  it('只保留合法条目（坏日期键、坏值都跳过，不算整体损坏）', () => {
    const root = tempRoot()
    writeFileSync(
      join(root, 'marks.json'),
      JSON.stringify({
        version: 1,
        days: {
          [DATE]: { [String(START)]: 'extra', [`${START}-x`]: 'extra', [String(START + 2000)]: 'nope' },
          'bad-date': { [String(START)]: 'feature' }
        }
      }),
      'utf8'
    )
    const store = new MarksStore(root)
    expect(store.get(DATE)).toEqual({ [String(START)]: 'extra' })
    expect(store.get('bad-date')).toEqual({})
    expect(readdirSync(root).filter((name) => name.startsWith('marks.corrupt-'))).toHaveLength(0)
  })

  it('原子写：成功时不留临时文件', () => {
    const root = tempRoot()
    new MarksStore(root).set(DATE, START, 'extra')
    expect(readdirSync(root)).toContain('marks.json')
    expect(readdirSync(root)).not.toContain('marks.json.tmp')
  })

  it('写失败抛出可读错误且清理临时文件', () => {
    const root = tempRoot()
    // 让 marks.json 是个目录：rename 覆盖必然失败
    mkdirSync(join(root, 'marks.json'), { recursive: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = new MarksStore(root)
    expect(() => store.set(DATE, START, 'extra')).toThrow(/标记保存失败/)
    expect(readdirSync(root)).not.toContain('marks.json.tmp')
    warn.mockRestore()
  })
})
