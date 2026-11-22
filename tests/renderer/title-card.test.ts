import { describe, expect, test } from 'vitest'
import {
  TITLE_CARD_FRAMES,
  TITLE_CARD_MS,
  shouldPlayTitleCard,
  titleCardOpacity,
  titleCardProgress
} from '../../src/renderer/src/lib/title-card'

describe('片头卡：是否播放', () => {
  test('第一次进入某天要播', () => {
    expect(shouldPlayTitleCard(new Set(), '2026-11-22', false)).toBe(true)
  })

  test('同一次运行同一天只播一次', () => {
    expect(shouldPlayTitleCard(new Set(['2026-11-22']), '2026-11-22', false)).toBe(false)
    expect(shouldPlayTitleCard(new Set(['2026-11-21']), '2026-11-22', false)).toBe(true)
  })

  test('减弱动效时不播', () => {
    expect(shouldPlayTitleCard(new Set(), '2026-11-22', true)).toBe(false)
    expect(shouldPlayTitleCard(new Set(['2026-11-21']), '2026-11-22', true)).toBe(false)
  })
})

describe('片头卡：时间轴', () => {
  test('总时长 1.4 秒', () => {
    expect(TITLE_CARD_MS).toBe(1400)
    expect(titleCardProgress(0)).toBe(0)
    expect(titleCardProgress(700)).toBe(0.5)
    expect(titleCardProgress(1400)).toBe(1)
    expect(titleCardProgress(5000)).toBe(1)
    expect(titleCardProgress(Number.NaN)).toBe(0)
  })

  test('日期 → 题材 → 字标依次出现', () => {
    expect(TITLE_CARD_FRAMES.map((frame) => frame.id)).toEqual(['date', 'verdict', 'mark'])
    for (let index = 1; index < TITLE_CARD_FRAMES.length; index += 1) {
      expect(TITLE_CARD_FRAMES[index].in[0]).toBeGreaterThan(TITLE_CARD_FRAMES[index - 1].in[0])
    }
  })

  test('每个区间都在 0–1 内且不越界', () => {
    for (const frame of TITLE_CARD_FRAMES) {
      for (const value of [frame.in[0], frame.in[1], frame.out[0], frame.out[1]]) {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      }
      expect(frame.in[1]).toBeGreaterThan(frame.in[0])
      expect(frame.out[0]).toBeLessThan(frame.out[1])
    }
  })

  test('元素在区间前透明、区间后不透明、末尾一起淡出', () => {
    const [date] = TITLE_CARD_FRAMES
    expect(titleCardOpacity(date, 0)).toBe(0)
    expect(titleCardOpacity(date, 0.13)).toBeCloseTo(0.5, 6)
    expect(titleCardOpacity(date, 0.3)).toBe(1)
    expect(titleCardOpacity(date, 0.94)).toBeCloseTo(0.5, 6)
    expect(titleCardOpacity(date, 1)).toBe(0)
  })

  test('后出现的元素在前一元素亮起后才开始', () => {
    const [, verdict, mark] = TITLE_CARD_FRAMES
    expect(titleCardOpacity(verdict, 0.1)).toBe(0)
    expect(titleCardOpacity(verdict, 0.29)).toBeGreaterThan(0)
    expect(titleCardOpacity(mark, 0.3)).toBe(0)
    expect(titleCardOpacity(mark, 0.45)).toBeGreaterThan(0)
  })
})
