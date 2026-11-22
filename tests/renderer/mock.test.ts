import { describe, expect, test } from 'vitest'
import { buildMockDay, buildMockLive, mockDates } from '../../src/renderer/src/mock'
import { startOfDay } from '../../src/renderer/src/lib/time'

const DAY = '2025-01-15'
const HOUR = 3_600_000
const dayStart = startOfDay(DAY)
const lateAfternoon = dayStart + 17 * HOUR + 42 * 60_000

describe('buildMockDay 确定性', () => {
  test('同一输入生成同一份胶片', () => {
    expect(buildMockDay(DAY, lateAfternoon)).toEqual(buildMockDay(DAY, lateAfternoon))
  })

  test('不同日期生成不同胶片', () => {
    const monday = buildMockDay(DAY, lateAfternoon)
    const tuesday = buildMockDay('2025-01-16', lateAfternoon)
    expect(monday.scenes.map((scene) => scene.id)).not.toEqual(tuesday.scenes.map((scene) => scene.id))
    expect(tuesday.date).toBe('2025-01-16')
  })
})

describe('buildMockDay 结构', () => {
  const day = buildMockDay(DAY, lateAfternoon)

  test('生成一整天的镜头', () => {
    expect(day.scenes.length).toBeGreaterThan(5)
    expect(day.scenes.some((scene) => scene.kind === 'intermission')).toBe(true)
  })

  test('按时间升序且互不重叠，秒数与起止一致', () => {
    day.scenes.forEach((scene, index) => {
      expect(scene.end).toBeGreaterThan(scene.start)
      expect(scene.seconds * 1000).toBe(scene.end - scene.start)
      expect(scene.end).toBeLessThanOrEqual(lateAfternoon)
      if (index > 0) {
        expect(scene.start).toBeGreaterThanOrEqual(day.scenes[index - 1].end)
      }
    })
    expect(day.firstAt).toBe(day.scenes[0].start)
    expect(day.lastAt).toBe(day.scenes[day.scenes.length - 1].end)
  })

  test('汇总与镜头集合自洽', () => {
    const shots = day.scenes.filter((scene) => scene.kind === 'shot')
    const rests = day.scenes.filter((scene) => scene.kind === 'intermission')
    const sum = (list: typeof shots): number =>
      list.reduce((total, scene) => total + scene.seconds * 1000, 0)
    expect(day.activeMs).toBe(sum(shots))
    expect(day.idleMs).toBe(sum(rests))
    expect(day.cuts).toBeLessThanOrEqual(shots.length)
    expect(day.longestShot).toBe(shots.reduce((longest, scene) => (scene.seconds > longest.seconds ? scene : longest)))
    expect(day.topApps.length).toBeLessThanOrEqual(5)
    expect(day.topApps.length).toBeGreaterThan(0)
    const exes = new Set(shots.map((scene) => scene.exe))
    for (const app of day.topApps) expect(exes.has(app.exe)).toBe(true)
  })

  test('进程排行按降序且不重复', () => {
    const names = day.topApps.map((app) => app.exe)
    expect(new Set(names).size).toBe(names.length)
    const seconds = day.topApps.map((app) => app.seconds)
    expect([...seconds].sort((a, b) => b - a)).toEqual(seconds)
  })

  test('题材与剪辑密度一致', () => {
    expect(day.verdict.cutRate).toBeCloseTo(day.cuts / (day.activeMs / HOUR), 6)
    expect(day.verdict.label).not.toBe('未开镜')
    expect(day.verdict.note.length).toBeGreaterThan(0)
  })
})

describe('buildMockDay 边界', () => {
  test('零点得到空胶片，不产生 NaN', () => {
    const day = buildMockDay(DAY, dayStart)
    expect(day.scenes).toEqual([])
    expect(day.activeMs).toBe(0)
    expect(day.idleMs).toBe(0)
    expect(day.firstAt).toBeNull()
    expect(day.lastAt).toBeNull()
    expect(day.longestShot).toBeNull()
    expect(day.topApps).toEqual([])
    expect(Number.isNaN(day.verdict.cutRate)).toBe(false)
    expect(day.verdict.label).toBe('未开镜')
  })

  test('清晨也有至少一个镜头', () => {
    const day = buildMockDay(DAY, dayStart + 6 * HOUR)
    expect(day.scenes.length).toBeGreaterThan(0)
    expect(day.lastAt).toBe(dayStart + 6 * HOUR)
  })

  test('超过当日 24:00 的部分被截断', () => {
    const day = buildMockDay(DAY, dayStart + 40 * HOUR)
    expect(day.lastAt).toBeLessThanOrEqual(dayStart + 24 * HOUR)
  })
})

describe('buildMockLive', () => {
  test('最后一个镜头就是正在拍摄的镜头', () => {
    const live = buildMockLive(DAY, lateAfternoon)
    expect(live.capturing).toBe(true)
    expect(live.captureError).toBeNull()
    expect(live.storageError).toBeNull()
    expect(live.paused).toBe(false)
    expect(live.scene?.kind).toBe('shot')
    expect(live.scene?.end).toBe(lateAfternoon)
    expect(live.day.date).toBe(DAY)
  })

  test('采集错误时 capturing 为 false', () => {
    const live = buildMockLive(DAY, lateAfternoon, { captureError: '采样子进程已退出' })
    expect(live.capturing).toBe(false)
    expect(live.captureError).toBe('采样子进程已退出')
  })

  test('暂停与写入异常可以同时存在', () => {
    const live = buildMockLive(DAY, lateAfternoon, { paused: true, storageError: '磁盘写失败' })
    expect(live.paused).toBe(true)
    expect(live.storageError).toBe('磁盘写失败')
    expect(live.capturing).toBe(true)
  })

  test('零点的实时状态没有正在拍摄的镜头', () => {
    const live = buildMockLive(DAY, dayStart)
    expect(live.scene).toBeNull()
    expect(live.day.scenes).toEqual([])
  })
})

describe('密集模式（长列表验收用）', () => {
  test('一整天生成数百个短镜头，仍然升序不重叠', () => {
    const day = buildMockDay(DAY, lateAfternoon, { dense: true })
    expect(day.scenes.length).toBeGreaterThan(500)
    day.scenes.forEach((scene, index) => {
      expect(Math.round(scene.seconds * 1000)).toBe(scene.end - scene.start)
      if (index > 0) expect(scene.start).toBeGreaterThanOrEqual(day.scenes[index - 1].end)
    })
    expect(day.lastAt).toBe(lateAfternoon)
  })

  test('密集模式仍是确定性的', () => {
    expect(buildMockDay(DAY, lateAfternoon, { dense: true })).toEqual(
      buildMockDay(DAY, lateAfternoon, { dense: true })
    )
  })
})

describe('mockDates', () => {
  test('给出今天与之前十三天，升序', () => {
    const dates = mockDates(lateAfternoon)
    expect(dates).toHaveLength(14)
    expect(dates[0]).toBe('2025-01-02')
    expect(dates[13]).toBe('2025-01-15')
    expect([...dates].sort()).toEqual(dates)
  })
})
