import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_NOTE_CHARS, NotesStore, clampNote } from '../../src/main/notes'

const DATE = '2026-11-22'
const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dayfilm-notes-'))
  roots.push(root)
  return root
}

function readFile(root: string): { version: number; notes: Record<string, string> } {
  return JSON.parse(readFileSync(join(root, 'notes.json'), 'utf8'))
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true })
})

describe('NotesStore', () => {
  it('写入后读回，结构是 { version: 1, notes }', () => {
    const root = tempRoot()
    const store = new NotesStore(root)
    expect(store.set(DATE, '今天收尾不错')).toBe('今天收尾不错')
    expect(store.get(DATE)).toBe('今天收尾不错')
    expect(readFile(root)).toEqual({ version: 1, notes: { [DATE]: '今天收尾不错' } })
    expect(new NotesStore(root).get(DATE)).toBe('今天收尾不错')
  })

  it('多条手记互不影响', () => {
    const store = new NotesStore(tempRoot())
    store.set('2026-11-21', 'A')
    store.set(DATE, 'B')
    expect(store.get('2026-11-21')).toBe('A')
    expect(store.get(DATE)).toBe('B')
    expect(store.get('2026-11-20')).toBe('')
  })

  it('trim 与去 \\r', () => {
    const store = new NotesStore(tempRoot())
    expect(store.set(DATE, '  第一行\r\n第二行  ')).toBe('第一行\n第二行')
  })

  it('按码点截断到 200，不切坏 emoji', () => {
    const store = new NotesStore(tempRoot())
    const long = '😀'.repeat(250)
    const saved = store.set(DATE, long)
    expect(Array.from(saved)).toHaveLength(MAX_NOTE_CHARS)
    expect(saved).toBe('😀'.repeat(MAX_NOTE_CHARS))
    expect(Array.from(store.get(DATE))).toHaveLength(MAX_NOTE_CHARS)
  })

  it('空文本删除该键并落盘', () => {
    const root = tempRoot()
    const store = new NotesStore(root)
    store.set(DATE, '要删的')
    expect(store.set(DATE, '   ')).toBe('')
    expect(store.get(DATE)).toBe('')
    expect(readFile(root).notes).toEqual({})
  })

  it('非法日期：get 返回空串，set 抛可读错误', () => {
    const store = new NotesStore(tempRoot())
    expect(store.get('yesterday')).toBe('')
    expect(store.get('')).toBe('')
    expect(() => store.set('2026-1-2', 'x')).toThrow(/手记日期不合法/)
  })

  it('损坏文件按空集合处理，并留档原文件', () => {
    const root = tempRoot()
    writeFileSync(join(root, 'notes.json'), '{ not json', 'utf8')
    const store = new NotesStore(root)
    expect(store.get(DATE)).toBe('')

    const backups = readdirSync(root).filter((name) => /^notes\.corrupt-.+\.json$/.test(name))
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(root, backups[0]), 'utf8')).toBe('{ not json')

    // 坏文件恢复后可以正常写
    store.set(DATE, '新的手记')
    expect(readFile(root)).toEqual({ version: 1, notes: { [DATE]: '新的手记' } })
    expect(readdirSync(root).filter((name) => name.startsWith('notes.corrupt-'))).toHaveLength(1)
  })

  it('缺 notes 字段或值不是字符串时只保留合法条目', () => {
    const root = tempRoot()
    writeFileSync(
      join(root, 'notes.json'),
      JSON.stringify({ version: 1, notes: { [DATE]: 'ok', 'bad-date': 'x', '2026-11-21': 42 } }),
      'utf8'
    )
    const store = new NotesStore(root)
    expect(store.get(DATE)).toBe('ok')
    expect(store.get('2026-11-21')).toBe('')
    expect(readdirSync(root).filter((name) => name.startsWith('notes.corrupt-'))).toHaveLength(0)
  })

  it('原子写：成功时不留临时文件', () => {
    const root = tempRoot()
    new NotesStore(root).set(DATE, 'x')
    expect(readdirSync(root)).toContain('notes.json')
    expect(readdirSync(root)).not.toContain('notes.json.tmp')
  })

  it('写失败抛出可读错误且清理临时文件', () => {
    const root = tempRoot()
    // 让 notes.json 是个目录：rename 覆盖必然失败
    mkdirSync(join(root, 'notes.json'), { recursive: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = new NotesStore(root)
    expect(() => store.set(DATE, 'x')).toThrow(/手记保存失败/)
    expect(readdirSync(root)).not.toContain('notes.json.tmp')
    warn.mockRestore()
  })
})

describe('clampNote', () => {
  it('去 \\r、trim、按码点截断', () => {
    expect(clampNote('  a\r\nb  ')).toBe('a\nb')
    expect(clampNote('x'.repeat(300))).toHaveLength(200)
    expect(clampNote('')).toBe('')
  })
})
