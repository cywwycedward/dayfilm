import { describe, expect, it } from 'vitest'
import { ensureExtension } from '../../src/main/export'
import { decodePngBase64, sanitizeImageName } from '../../src/main/save-image'

/** 最小合法 PNG 头 + 一点负载 */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('payload')])

describe('decodePngBase64', () => {
  it('合法 PNG 解码成功', () => {
    const bytes = decodePngBase64(PNG.toString('base64'))
    expect(bytes).not.toBeNull()
    expect(bytes?.equals(PNG)).toBe(true)
  })

  it('非字符串、空串、非法 base64、非 PNG 内容一律拒绝', () => {
    expect(decodePngBase64(undefined)).toBeNull()
    expect(decodePngBase64(42)).toBeNull()
    expect(decodePngBase64('')).toBeNull()
    expect(decodePngBase64('   ')).toBeNull()
    expect(decodePngBase64('!!!!')).toBeNull()
    expect(decodePngBase64(Buffer.from('hello world').toString('base64'))).toBeNull()
    expect(decodePngBase64(Buffer.from([0x89, 0x50, 0x4e]).toString('base64'))).toBeNull()
  })

  it('解码后超过上限就拒绝', () => {
    const encoded = PNG.toString('base64')
    expect(decodePngBase64(encoded, PNG.length - 1)).toBeNull()
    expect(decodePngBase64(encoded, PNG.length)).not.toBeNull()
  })

  it('超大输入在分配内存前就被挡掉', () => {
    const huge = `${'A'.repeat(64)}${'='.repeat(1)}`
    expect(decodePngBase64(huge, 8)).toBeNull()
  })
})

describe('sanitizeImageName', () => {
  it('补 .png 并去掉重复扩展名', () => {
    expect(sanitizeImageName('dayfilm-2026-11-22')).toBe('dayfilm-2026-11-22.png')
    expect(sanitizeImageName('poster.PNG')).toBe('poster.png')
    expect(sanitizeImageName('poster.png')).toBe('poster.png')
  })

  it('只取文件名部分，去掉目录与路径穿越', () => {
    expect(sanitizeImageName('C:\\Users\\x\\poster.png')).toBe('poster.png')
    expect(sanitizeImageName('a/b/c')).toBe('c.png')
    expect(sanitizeImageName('..\\..\\evil.png')).toBe('evil.png')
    expect(sanitizeImageName('../evil.png')).toBe('evil.png')
  })

  it('去掉 Windows 非法字符并兜底', () => {
    expect(sanitizeImageName('a:b*c?d|e"f<g>h.png')).toBe('abcdefgh.png')
    expect(sanitizeImageName('   ')).toBe('dayfilm.png')
    expect(sanitizeImageName('')).toBe('dayfilm.png')
    expect(sanitizeImageName(undefined)).toBe('dayfilm.png')
    expect(sanitizeImageName(123)).toBe('dayfilm.png')
  })

  it('超长名称截到 80 字符', () => {
    expect(sanitizeImageName('x'.repeat(200))).toBe(`${'x'.repeat(80)}.png`)
  })
})

describe('ensureExtension', () => {
  it('按目标扩展名归一', () => {
    expect(ensureExtension('C:\\a\\poster.txt', 'png')).toBe('C:\\a\\poster.png')
    expect(ensureExtension('C:\\a\\poster', 'png')).toBe('C:\\a\\poster.png')
    expect(ensureExtension('C:\\a\\poster.PNG', 'png')).toBe('C:\\a\\poster.PNG')
    expect(ensureExtension('C:\\a.b\\poster', '.png')).toBe('C:\\a.b\\poster.png')
  })
})
