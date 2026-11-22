import { describe, expect, test } from 'vitest'
import { projectionFrameParams } from '../../src/renderer/src/lib/projection-frame'

const HOUR = 3_600_000
const base = {
  date: '2026-11-22',
  shot: 26,
  total: 60,
  exe: 'WindowsTerminal',
  title: 'LZD-20250906UAB: not-my-app',
  hue: 280,
  start: new Date(2026, 10, 22, 20, 45).getTime(),
  end: new Date(2026, 10, 22, 20, 47).getTime(),
  seconds: 162,
  maxSeconds: 254,
  grainSeed: 12345,
  width: 998,
  height: 562
}

describe('放映画面版式', () => {
  const params = projectionFrameParams(base)

  test('信息一项不少：日期与镜次、应用名、标题、时间码、时长与当天最长', () => {
    const texts = params.lines.map((line) => line.text)
    expect(texts[0]).toBe('2026-11-22 · SHOT 26 / 60')
    expect(texts[1]).toBe('WINDOWSTERMINAL')
    expect(texts[2]).toBe('LZD-20250906UAB: not-my-app')
    expect(texts[3]).toBe('20:45–20:47')
    expect(texts[4]).toBe('2 分 42 秒 / 4 分 14 秒')
  })

  test('背景大数字：高度 55%、右对齐 8% 处、垂直居中、4% 不透明度', () => {
    const badge = params.bigNumber
    expect(badge.text).toBe('26')
    expect(badge.size).toBe(Math.round(562 * 0.55))
    expect(badge.x).toBe(params.width - Math.round(params.width * 0.08))
    expect(badge.y).toBe(Math.round(562 / 2))
    expect(badge.opacity).toBeCloseTo(0.04, 6)
  })

  test('文本块起点固定在宽度的 8%，应用名基线在高度 52%', () => {
    const textX = Math.round(params.width * 0.08)
    expect(params.lines[1].x).toBe(textX)
    expect(params.lines[2].x).toBe(textX)
    expect(params.lines[1].y).toBe(Math.round(params.height * 0.52))
    expect(params.top.x0).toBe(textX)
    expect(params.top.x1).toBe(params.width - textX)
  })

  test('时长尺：整幅宽、填充比例 = 本镜 / 当天最长', () => {
    const ruler = params.ruler
    expect(ruler.x0).toBe(0)
    expect(ruler.x1).toBe(params.width)
    expect(ruler.ratio).toBeCloseTo(162 / 254, 6)
    expect(ruler.fill).toBe(Math.round(params.width * (162 / 254)))
    expect(ruler.y).toBeLessThan(params.height)
    expect(ruler.y).toBeGreaterThan(params.height - 60)
  })

  test('最长镜头时长不足时比例封顶为 1，标签仍写全', () => {
    const over = projectionFrameParams({ ...base, seconds: 999, maxSeconds: 100 })
    expect(over.ruler.ratio).toBe(1)
    expect(over.ruler.fill).toBe(over.width)
    expect(over.lines[4].text).toContain('/ 1 分 40 秒')
  })

  test('颗粒：数量是面积的 3%，种子原样传递，确定性', () => {
    expect(params.grain.count).toBe(Math.round(998 * 562 * 0.03))
    expect(params.grain.seed).toBe(12345)
    expect(projectionFrameParams(base)).toEqual(params)
  })

  test('字体与字号：应用名 Bebas 28–40，标题 Inter 11+，数字 Plex Mono', () => {
    expect(params.lines[1].family).toBe('display')
    expect(params.lines[1].size).toBeGreaterThanOrEqual(28)
    expect(params.lines[1].size).toBeLessThanOrEqual(40)
    expect(params.lines[2].family).toBe('ui')
    expect(params.lines[2].size).toBeGreaterThanOrEqual(11)
    for (const index of [0, 3, 4]) {
      expect(params.lines[index].family).toBe('mono')
      expect(params.lines[index].size).toBeGreaterThanOrEqual(9)
    }
    expect(params.lines[4].size).toBe(9)
  })

  test('所有文字都在画面内，时间码与时长尺标签同一行不重叠', () => {
    for (const line of params.lines) {
      expect(line.x).toBeGreaterThanOrEqual(0)
      expect(line.x).toBeLessThanOrEqual(params.width)
      expect(line.y).toBeGreaterThan(0)
      expect(line.y).toBeLessThan(params.height)
    }
    expect(params.lines[4].align).toBe('right')
    expect(params.lines[4].y).toBeLessThan(params.ruler.y)
  })

  test('发丝线在顶部与底部，暗角 6%，中场休息不画族色条', () => {
    expect(params.top.y).toBeLessThan(params.height / 2)
    expect(params.bottom.y).toBeGreaterThan(params.height / 2)
    expect(params.vignette).toBeCloseTo(0.06, 6)
    expect(params.sideBar).toBeGreaterThanOrEqual(3)
    expect(projectionFrameParams({ ...base, showBar: false }).sideBar).toBe(0)
  })

  test('小画面也保持字号下限，大数字按帧高缩', () => {
    const small = projectionFrameParams({ ...base, width: 480, height: 270 })
    expect(small.lines[1].size).toBeGreaterThanOrEqual(28)
    expect(small.bigNumber.size).toBe(Math.round(270 * 0.55))
    for (const line of small.lines) expect(Number.isInteger(line.size)).toBe(true)
  })

  test('时长格式：分钟、小时与整分', () => {
    const at = (seconds: number) => projectionFrameParams({ ...base, seconds }).lines[4].text
    expect(at(45)).toBe('0 分 45 秒 / 4 分 14 秒')
    expect(at(180)).toBe('3 分 / 4 分 14 秒')
    expect(at(4320)).toBe('1 小时 12 分 / 4 分 14 秒')
  })

  test('跨小时的镜头时间码', () => {
    const crossing = projectionFrameParams({ ...base, start: base.end - HOUR, seconds: HOUR / 1000 })
    expect(crossing.lines[3].text).toBe('19:47–20:47')
  })
})
