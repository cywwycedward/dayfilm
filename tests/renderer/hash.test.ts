import { describe, expect, test } from 'vitest'
import { hashString, seededRandom, unitAt } from '../../src/renderer/src/lib/hash'

describe('hashString', () => {
  test('空串返回 FNV-1a 初始值', () => {
    expect(hashString('')).toBe(0x811c9dc5)
  })

  test('同一输入永远得到同一个值', () => {
    const once = hashString('Code|dayfilm - Visual Studio Code')
    expect(hashString('Code|dayfilm - Visual Studio Code')).toBe(once)
    expect(hashString('Code|dayfilm - Visual Studio Code')).toBe(once)
  })

  test('相近或大小写不同的输入得到不同值', () => {
    expect(hashString('a')).not.toBe(hashString('b'))
    expect(hashString('Code')).not.toBe(hashString('code'))
    expect(hashString('Code|a')).not.toBe(hashString('Code|ab'))
  })

  test('结果始终是无符号 32 位整数', () => {
    for (const input of ['', 'a', '中文字符', 'x'.repeat(300)]) {
      const value = hashString(input)
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(0xffffffff)
    }
  })
})

describe('unitAt', () => {
  test('落在 [0,1) 且可重复', () => {
    const seed = hashString('Code|dayfilm')
    for (let salt = 0; salt < 12; salt += 1) {
      const value = unitAt(seed, salt)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
      expect(unitAt(seed, salt)).toBe(value)
    }
  })

  test('不同 salt 给出不同数值', () => {
    const seed = hashString('Code|dayfilm')
    expect(new Set([unitAt(seed, 1), unitAt(seed, 2), unitAt(seed, 3)]).size).toBe(3)
  })
})

describe('seededRandom', () => {
  test('同种子给出同序列', () => {
    const first = seededRandom(7)
    const second = seededRandom(7)
    for (let index = 0; index < 6; index += 1) {
      expect(first()).toBe(second())
    }
  })

  test('不同种子给出不同序列', () => {
    const draw = (seed: number): number[] => {
      const random = seededRandom(seed)
      return [random(), random(), random(), random()]
    }
    expect(draw(1)).not.toEqual(draw(2))
  })

  test('输出落在 [0,1)', () => {
    const random = seededRandom(42)
    for (let index = 0; index < 20; index += 1) {
      const value = random()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})
