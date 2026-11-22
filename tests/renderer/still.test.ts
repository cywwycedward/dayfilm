import { describe, expect, test } from 'vitest'
import { exeBand, exeHue, stillSpec, type StillShape } from '../../src/renderer/src/lib/still'

const SHAPES: StillShape[] = ['lines', 'rings', 'bars', 'frame']

describe('stillSpec', () => {
  test('同一 (exe, title) 参数完全稳定', () => {
    const once = stillSpec('Code', 'dayfilm - Visual Studio Code')
    expect(stillSpec('Code', 'dayfilm - Visual Studio Code')).toEqual(once)
  })

  test('标题不同则画面不同', () => {
    expect(stillSpec('Code', 'a').seed).not.toBe(stillSpec('Code', 'b').seed)
    expect(stillSpec('Code', 'a').hue).not.toBe(stillSpec('Code', 'a').hueAccent)
  })

  test('exe 不同则种子不同', () => {
    expect(stillSpec('Code', 'x').seed).not.toBe(stillSpec('chrome', 'x').seed)
  })

  test('形状与参数都在约定范围内', () => {
    for (const exe of ['Code', 'chrome', 'WindowsTerminal', 'Notion', 'Figma', 'WeChat']) {
      const spec = stillSpec(exe, '标题')
      expect(SHAPES).toContain(spec.shape)
      expect(spec.bands).toBeGreaterThanOrEqual(3)
      expect(spec.bands).toBeLessThanOrEqual(6)
      expect(spec.angle).toBeGreaterThanOrEqual(0)
      expect(spec.angle).toBeLessThan(Math.PI * 2)
      expect(spec.hue).toBeGreaterThanOrEqual(0)
      expect(spec.hue).toBeLessThan(360)
      expect(spec.hueAccent).toBeGreaterThanOrEqual(0)
      expect(spec.hueAccent).toBeLessThan(360)
    }
  })
})

describe('进程族色带', () => {
  test('色相落在自己的色带内，同 exe 稳定', () => {
    for (const exe of ['Code', 'chrome', 'WindowsTerminal', 'Notion', 'Figma', 'explorer']) {
      const band = exeBand(exe)
      expect(band).toBeGreaterThanOrEqual(0)
      expect(band).toBeLessThan(12)
      expect(exeBand(exe)).toBe(band)
      expect(Math.floor(exeHue(exe) / 30)).toBe(band)
    }
  })

  test('大小写与空白不影响色带归属', () => {
    expect(exeBand(' Code ')).toBe(exeBand('code'))
  })
})
