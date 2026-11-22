import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { expandRealPath, isTrustedFrameUrl } from '../../src/main/security'

const ORIGIN = { rendererFileUrl: 'file:///D:/App/Out/Renderer/index.html' }

describe('isTrustedFrameUrl 的 file 地址归一', () => {
  it('大小写不同视为同一个页面（Windows 路径不敏感）', () => {
    expect(isTrustedFrameUrl('file:///d:/app/out/renderer/index.html', ORIGIN)).toBe(true)
    expect(isTrustedFrameUrl('file:///D:/app/out/renderer/INDEX.HTML', ORIGIN)).toBe(true)
  })

  it('同一目录下的其它页面仍然拒绝', () => {
    expect(isTrustedFrameUrl('file:///D:/App/Out/Renderer/other.html', ORIGIN)).toBe(false)
    expect(isTrustedFrameUrl('file:///D:/App/Out/Renderer/index.html.bak', ORIGIN)).toBe(false)
  })

  it('百分号编码与原文等价', () => {
    const origin = { rendererFileUrl: 'file:///D:/App%20Dir/out/renderer/index.html' }
    expect(isTrustedFrameUrl('file:///D:/App%20Dir/out/renderer/index.html', origin)).toBe(true)
    expect(isTrustedFrameUrl('file:///D:/App Dir/out/renderer/index.html', origin)).toBe(true)
  })
})

describe('expandRealPath', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dayfilm-canon-'))
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('把真实存在目录的大小写还原成磁盘上的写法', () => {
    mkdirSync(join(dir, 'CaseDir'))
    const expanded = expandRealPath(join(dir, 'casedir', 'x.txt'))
    expect(expanded.endsWith(join('CaseDir', 'x.txt'))).toBe(true)
  })

  it('asar 这种不存在于文件系统的路径退到最近的真实祖先', () => {
    const asarPath = join(dir, 'resources', 'app.asar', 'out', 'renderer', 'index.html')
    const expanded = expandRealPath(asarPath)
    expect(expanded.toLowerCase().endsWith(join('app.asar', 'out', 'renderer', 'index.html').toLowerCase())).toBe(true)
  })
})
