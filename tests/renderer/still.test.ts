import { describe, expect, test } from 'vitest'
import { exeBand, exeHue } from '../../src/renderer/src/lib/still'

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

  test('同族的 exe 得到同一色相，不同族可能不同', () => {
    expect(exeHue('Code')).toBe(exeHue('code'))
    expect(exeHue('chrome')).toBeGreaterThanOrEqual(0)
    expect(exeHue('chrome')).toBeLessThan(360)
  })

  test('大小写与空白不影响色带归属', () => {
    expect(exeBand(' Code ')).toBe(exeBand('code'))
  })
})
