import { describe, expect, test } from 'vitest'
import type { Scene } from '../../src/shared/types'
import {
  advanceProjection,
  cutsPerSecond,
  enterProjection,
  exitProjection,
  filmBounds,
  playbackRange,
  playbackStart,
  projectionFinished,
  setProjectionSound,
  setProjectionSpeed,
  shotAt,
  shotIndexMap,
  showCutRate
} from '../../src/renderer/src/lib/projection'
import { startOfDay } from '../../src/renderer/src/lib/time'

const DATE = '2026-11-22'
const HOUR = 3_600_000
const MINUTE = 60_000
const dayStart = startOfDay(DATE)

function shot(id: string, fromHour: number, minutes: number): Scene {
  const start = dayStart + fromHour * HOUR
  return { id, start, end: start + minutes * MINUTE, exe: 'Code', title: id, seconds: minutes * 60, kind: 'shot' }
}

function rest(id: string, fromHour: number, minutes: number): Scene {
  const start = dayStart + fromHour * HOUR
  return { id, start, end: start + minutes * MINUTE, exe: '', title: '中场休息', seconds: minutes * 60, kind: 'intermission' }
}

const scenes: Scene[] = [
  shot('a', 9, 10), // 09:00–09:10
  shot('b', 9.2, 10), // 09:12–09:22
  rest('r', 9.5, 20), // 09:30–09:50
  shot('c', 10, 30) // 10:00–10:30
]

describe('放映：进入', () => {
  test('指针夹进胶片范围，镜次与总数正确', () => {
    const state = enterProjection(dayStart + 5 * HOUR, scenes)
    expect(state.active).toBe(true)
    expect(state.filmMs).toBe(scenes[0].start)
    expect(state.shot).toBe(1)
    expect(state.total).toBe(3)
    expect(state.cuts).toBe(0)
  })

  test('从中间进入会落在对应的镜次', () => {
    expect(enterProjection(scenes[1].start + MINUTE, scenes).shot).toBe(2)
    expect(enterProjection(scenes[3].start + MINUTE, scenes).shot).toBe(3)
  })

  test('空隙与中场休息没有镜次', () => {
    expect(enterProjection(scenes[2].start + MINUTE, scenes).shot).toBe(0)
    expect(shotAt(scenes[2].start + MINUTE, scenes)).toBe(0)
  })

  test('没有镜头也能进入，但总数为 0', () => {
    const state = enterProjection(dayStart, [])
    expect(state.active).toBe(true)
    expect(state.total).toBe(0)
    expect(filmBounds([])).toBeNull()
  })

  test('倍速与声音可以带入', () => {
    const state = enterProjection(scenes[0].start, scenes, { speed: 3600, sound: true })
    expect(state.speed).toBe(3600)
    expect(state.sound).toBe(true)
  })
})

describe('放映：推进', () => {
  test('600x 下 1 秒真实时间前进 10 分钟胶片', () => {
    const start = enterProjection(scenes[0].start, scenes)
    const next = advanceProjection(start, 1000, scenes)
    expect(next.filmMs - start.filmMs).toBe(600 * 1000)
    expect(next.realMs).toBe(1000)
  })

  test('跨镜头记一次剪辑', () => {
    const start = enterProjection(scenes[0].start, scenes)
    // 09:00 起 12 分钟（720 秒）后进入第二个镜头：600x 下需要 1.2 秒
    const next = advanceProjection(start, 1200, scenes)
    expect(next.shot).toBe(2)
    expect(next.cuts).toBe(1)
  })

  test('在同一镜头内推进不记剪辑', () => {
    const start = enterProjection(scenes[0].start, scenes)
    const next = advanceProjection(start, 200, scenes)
    expect(next.shot).toBe(1)
    expect(next.cuts).toBe(0)
  })

  test('走到胶片末尾就停住，不再前进', () => {
    const start = enterProjection(scenes[3].start, scenes)
    const next = advanceProjection(start, 10_000, scenes)
    expect(next.filmMs).toBe(scenes[3].end)
    expect(projectionFinished(next, scenes)).toBe(true)
  })

  test('退出后不再推进', () => {
    const start = exitProjection(enterProjection(scenes[0].start, scenes))
    expect(advanceProjection(start, 1000, scenes)).toEqual(start)
  })

  test('非法 delta 不产生 NaN', () => {
    const start = enterProjection(scenes[0].start, scenes)
    const next = advanceProjection(start, Number.NaN, scenes)
    expect(Number.isFinite(next.filmMs)).toBe(true)
    expect(next.realMs).toBe(0)
  })
})

describe('放映：切速与声音', () => {
  test('切速不影响指针', () => {
    const start = enterProjection(scenes[0].start, scenes)
    const fast = setProjectionSpeed(start, 3600)
    expect(fast.filmMs).toBe(start.filmMs)
    expect(fast.speed).toBe(3600)
  })

  test('声音开关可开可关，不抛错', () => {
    const on = setProjectionSound(enterProjection(scenes[0].start, scenes), true)
    expect(on.sound).toBe(true)
    expect(setProjectionSound(on, false).sound).toBe(false)
  })

  test('退出保留指针，active 置 false', () => {
    const start = advanceProjection(enterProjection(scenes[0].start, scenes), 300, scenes)
    const exited = exitProjection(start)
    expect(exited.active).toBe(false)
    expect(exited.filmMs).toBe(start.filmMs)
  })
})

describe('每秒剪辑读数', () => {
  test('真实时间太短时给 0', () => {
    const start = enterProjection(scenes[0].start, scenes)
    expect(cutsPerSecond(start)).toBe(0)
  })

  test('按真实时间算每秒剪辑数', () => {
    const start = enterProjection(scenes[0].start, scenes)
    const moved = advanceProjection(start, 2000, scenes)
    const cut = { ...moved, cuts: 4, realMs: 2000 }
    expect(cutsPerSecond(cut)).toBe(2)
  })

  test('只有 600x 以上才显示读数', () => {
    expect(showCutRate(60)).toBe(false)
    expect(showCutRate(600)).toBe(true)
    expect(showCutRate(3600)).toBe(true)
  })
})

describe('镜次表', () => {
  test('只数镜头，中场休息不占号', () => {
    const map = shotIndexMap(scenes)
    expect(map.get('a')).toBe(1)
    expect(map.has('r')).toBe(false)
    expect(map.get('c')).toBe(3)
  })
})

describe('播放起点', () => {
  test('有选中就从选中镜头的开始播', () => {
    expect(playbackStart(scenes[2], scenes)).toBe(scenes[2].start)
  })

  test('选中的是中场休息也从它开始', () => {
    const rest = scenes.find((scene) => scene.kind === 'intermission') ?? null
    expect(rest).not.toBeNull()
    if (!rest) throw new Error('缺少中场休息用例')
    expect(playbackStart(rest, scenes)).toBe(rest.start)
  })

  test('没选中就用当天第一个镜头，不是 00:00', () => {
    expect(playbackStart(null, scenes)).toBe(scenes[0].start)
    expect(playbackStart(null, scenes)).toBeGreaterThan(dayStart)
  })

  test('前面只有中场休息时跳过它', () => {
    const leadingRest = [rest('r0', 8, 30), ...scenes]
    expect(playbackStart(null, leadingRest)).toBe(scenes[0].start)
  })

  test('没有素材返回 null', () => {
    expect(playbackStart(null, [])).toBeNull()
    expect(playbackStart(null, [rest('r', 12, 20)])).toBeNull()
  })
})

describe('素材区间', () => {
  test('首镜开始到末镜结束', () => {
    const range = playbackRange(scenes)
    expect(range).toEqual({ start: scenes[0].start, end: scenes[scenes.length - 1].end })
  })

  test('尾部的 midfield 休息不算在区间里', () => {
    const trailing = [...scenes, rest('rz', 20, 30)]
    expect(playbackRange(trailing)).toEqual({
      start: scenes[0].start,
      end: scenes[scenes.length - 1].end
    })
  })

  test('只有中场休息时返回 null', () => {
    expect(playbackRange([rest('r', 12, 20)])).toBeNull()
    expect(playbackRange([])).toBeNull()
  })
})
