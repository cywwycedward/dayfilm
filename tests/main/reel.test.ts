import { describe, expect, it } from 'vitest'
import { applyMarks, buildDayRollup, isAutoExtra, renderScreenplay, searchScenes } from '../../src/main/reel'
import type { DayRollup, Sample } from '../../src/shared/types'

const STEP = 2000
const DATE = '2026-11-22'
/** 本地时间 2026-11-22 09:00。用本地构造，避免测试依赖机器时区。 */
const T0 = new Date(2026, 10, 22, 9, 0, 0, 0).getTime()

function sample(t: number, exe: string, title: string, idleMs = 0): Sample {
  return { t, exe, title, idleMs }
}

/** 造一天的采样：按 2 秒一格连续生成，镜头时长因此等于采样数 × 2 秒。 */
class Day {
  readonly samples: Sample[] = []
  private next = T0

  private run(seconds: number, exe: string, title: string, idleMs: number): this {
    const count = Math.round((seconds * 1000) / STEP)
    for (let index = 0; index < count; index += 1) {
      this.samples.push(sample(this.next, exe, title, idleMs))
      this.next += STEP
    }
    return this
  }

  shot(exe: string, title: string, seconds: number): this {
    return this.run(seconds, exe, title, 0)
  }

  idle(seconds: number): this {
    return this.run(seconds, 'LockApp', 'Lock screen', 100_000)
  }

  /** 没有前台窗口：脚本给空 exe 与空标题。 */
  away(seconds: number): this {
    return this.run(seconds, '', '', 0)
  }

  /** 采样空洞：采集暂停或休眠唤醒。 */
  gap(seconds: number): this {
    this.next += seconds * 1000
    return this
  }

  /** 最后一条采样之后一格，作为 buildDayRollup 的 now。 */
  get now(): number {
    return this.next
  }

  rollup(date = DATE): DayRollup {
    return buildDayRollup(this.samples, date, this.now)
  }
}

describe('buildDayRollup 归并', () => {
  it('同窗口连续采样续接成一个镜头', () => {
    const day = new Day().shot('Code', 'dayfilm', 10).shot('Code', 'dayfilm', 10).rollup()
    expect(day.scenes).toHaveLength(1)
    expect(day.scenes[0]).toMatchObject({ exe: 'Code', kind: 'shot', seconds: 20, id: `${DATE}-1` })
    expect(day.cuts).toBe(0)
  })

  it('换窗口就是一次剪辑', () => {
    const day = new Day().shot('Code', 'dayfilm', 10).shot('WindowsTerminal', 'npm test', 10).rollup()
    expect(day.scenes.map((scene) => scene.exe)).toEqual(['Code', 'WindowsTerminal'])
    expect(day.cuts).toBe(1)
    expect(day.scenes.map((scene) => scene.id)).toEqual([`${DATE}-1`, `${DATE}-2`])
  })

  it('同窗口但间隔超过 90 秒切成两个镜头，且不算剪辑', () => {
    const day = new Day().shot('Code', 'dayfilm', 10).gap(91).shot('Code', 'dayfilm', 10).rollup()
    expect(day.scenes).toHaveLength(2)
    expect(day.cuts).toBe(0)
    expect(day.activeMs).toBe(20_000)
  })

  it('乱序输入先排序，同 t 只保留先出现的一条', () => {
    const samples = [
      sample(T0 + 2 * STEP, 'Code', 'dayfilm'),
      sample(T0, 'Code', 'dayfilm'),
      sample(T0 + 3 * STEP, 'WindowsTerminal', 'npm test'),
      sample(T0 + STEP, 'Code', 'dayfilm'),
      sample(T0 + 3 * STEP, 'Ignored', 'dup'),
      sample(T0 + 4 * STEP, 'WindowsTerminal', 'npm test')
    ]
    const day = buildDayRollup(samples, DATE, T0 + 5 * STEP)
    expect(day.scenes.map((scene) => scene.exe)).toEqual(['Code', 'WindowsTerminal'])
    expect(day.scenes.map((scene) => scene.seconds)).toEqual([6, 4])
    expect(day.firstAt).toBe(T0)
    expect(day.lastAt).toBe(T0 + 4 * STEP)
  })
})

describe('buildDayRollup 短镜头与中场休息', () => {
  it('不足 3 秒的镜头被丢弃，时间也不并入相邻镜头', () => {
    const day = new Day().shot('Code', 'dayfilm', 10).shot('Slack', '#general', 2).shot('Code', 'dayfilm', 10).rollup()
    expect(day.scenes.map((scene) => scene.exe)).toEqual(['Code', 'Code'])
    expect(day.scenes.map((scene) => scene.seconds)).toEqual([10, 10])
    expect(day.activeMs).toBe(20_000)
  })

  it('空闲满 60 秒生成中场休息，且停在最后一次采样时刻', () => {
    const day = new Day().shot('Code', 'dayfilm', 10).idle(120).shot('Code', 'dayfilm', 10).rollup()
    const intermission = day.scenes.find((scene) => scene.kind === 'intermission')
    expect(intermission).toBeDefined()
    expect(day.scenes.map((scene) => scene.kind)).toEqual(['shot', 'intermission', 'shot'])
    expect(day.idleMs).toBe(118_000)
    expect(day.activeMs).toBe(20_000)
  })

  it('空闲持续到 now 时镜头结尾取最后一次采样，不拉到 now', () => {
    const day = new Day().shot('Code', 'dayfilm', 10).idle(120)
    const lastIdleT = day.samples[day.samples.length - 1].t
    const rollup = buildDayRollup(day.samples, DATE, lastIdleT + 600_000)
    const intermission = rollup.scenes[rollup.scenes.length - 1]
    expect(intermission.kind).toBe('intermission')
    expect(intermission.end).toBe(lastIdleT)
    expect(rollup.idleMs).toBe(118_000)
  })

  it('空闲 59 秒不生成中场休息', () => {
    const samples = [
      sample(T0, 'Code', 'dayfilm', 0),
      sample(T0 + STEP, 'Code', 'dayfilm', 0),
      sample(T0 + 2 * STEP, 'Chrome', 'MDN Canvas', 59_000),
      sample(T0 + 3 * STEP, 'Chrome', 'MDN Canvas', 59_000),
      sample(T0 + 4 * STEP, 'Code', 'dayfilm', 0),
      sample(T0 + 5 * STEP, 'Code', 'dayfilm', 0)
    ]
    const day = buildDayRollup(samples, DATE, T0 + 6 * STEP)
    expect(day.scenes.filter((scene) => scene.kind === 'intermission')).toEqual([])
    expect(day.idleMs).toBe(0)
    expect(day.scenes.map((scene) => scene.exe)).toEqual(['Code', 'Chrome', 'Code'])
    expect(day.cuts).toBe(2)
  })

  it('锁屏界面 LockApp 直接算中场休息，哪怕空闲值很小（真机锁屏就长这样）', () => {
    const samples = [
      sample(T0, 'Code', 'dayfilm', 0),
      sample(T0 + STEP, 'Code', 'dayfilm', 0),
      sample(T0 + 2 * STEP, 'LockApp', 'Windows 默认锁屏界面', 500),
      sample(T0 + 3 * STEP, 'LockApp', 'Windows 默认锁屏界面', 2500),
      sample(T0 + 4 * STEP, 'Code', 'dayfilm', 0),
      sample(T0 + 5 * STEP, 'Code', 'dayfilm', 0)
    ]
    const day = buildDayRollup(samples, DATE, T0 + 6 * STEP)
    expect(day.scenes.map((scene) => scene.kind)).toEqual(['shot', 'intermission', 'shot'])
    expect(day.cuts).toBe(0)
    expect(day.topApps.map((app) => app.exe)).toEqual(['Code'])
  })
})

describe('away 无前台窗口', () => {
  it('away 直接算中场休息，不生成镜头、不进 topApps、不计活跃时长', () => {
    const day = new Day().shot('Code', 'dayfilm', 10).away(10).shot('Code', 'dayfilm', 10).rollup()
    expect(day.scenes.map((scene) => scene.kind)).toEqual(['shot', 'intermission', 'shot'])
    expect(day.scenes.find((scene) => scene.kind === 'intermission')).toMatchObject({ exe: '', title: '' })
    expect(day.topApps.map((app) => app.exe)).toEqual(['Code'])
    expect(day.activeMs).toBe(20_000)
    expect(day.idleMs).toBe(8000)
    expect(day.cuts).toBe(0)
  })

  it('away 前后是同一窗口也是两个镜头，不连成一条', () => {
    const day = new Day().shot('Code', 'dayfilm', 10).away(4).shot('Code', 'dayfilm', 10).rollup()
    expect(day.scenes.filter((scene) => scene.kind === 'shot')).toHaveLength(2)
    expect(day.scenes.map((scene) => scene.id)).toEqual([`${DATE}-1`, `${DATE}-2`, `${DATE}-3`])
    expect(day.cuts).toBe(0)
  })
})

describe('buildDayRollup 剪辑与题材', () => {
  it('中间隔着一次中场休息也照样计数切换', () => {
    const day = new Day().shot('Code', 'dayfilm', 10).idle(120).shot('WindowsTerminal', 'npm test', 10).rollup()
    expect(day.scenes.map((scene) => scene.kind)).toEqual(['shot', 'intermission', 'shot'])
    expect(day.cuts).toBe(1)
  })

  it('最长镜头取最长的非空闲镜头', () => {
    const day = new Day().shot('Code', 'dayfilm', 30).shot('WindowsTerminal', 'npm test', 10).rollup()
    expect(day.longestShot?.exe).toBe('Code')
    expect(day.longestShot?.seconds).toBe(30)
    expect(day.verdict.note).toContain('Code')
    expect(day.verdict.note).toContain('分钟')
  })

  it('没有镜头时最长镜头为 null，点评提示还没形成长镜头', () => {
    const day = buildDayRollup([], DATE, T0)
    expect(day.scenes).toEqual([])
    expect(day.longestShot).toBeNull()
    expect(day.verdict.label).toBe('长镜头')
    expect(day.verdict.note).toContain('还没有形成长镜头')
    expect(day.firstAt).toBeNull()
    expect(day.lastAt).toBeNull()
  })

  it('进程时长排行按活跃时长倒序，最多 5 个', () => {
    const day = new Day()
    for (let index = 0; index < 7; index += 1) day.shot(`App${index}`, `window ${index}`, 10 + index * 10)
    const rollup = day.rollup()
    expect(rollup.topApps).toHaveLength(5)
    expect(rollup.topApps.map((app) => app.exe)).toEqual(['App6', 'App5', 'App4', 'App3', 'App2'])
    expect(rollup.topApps[0].seconds).toBe(70)
  })

  it('剪辑拆成跨应用与应用内两个子计数，和等于 cuts', () => {
    const day = new Day()
      .shot('Code', 'dayfilm', 10)
      .shot('Code', 'test.ts', 10)
      .shot('Slack', '#general', 10)
      .shot('Code', 'dayfilm', 10)
      .rollup()
    expect(day.withinAppCuts).toBe(1)
    expect(day.appCuts).toBe(2)
    expect(day.cuts).toBe(3)
    expect(day.cuts).toBe((day.appCuts ?? 0) + (day.withinAppCuts ?? 0))
  })

  /** cuts+1 个镜头均匀铺满 1 小时活跃时长，剪辑密度精确等于 cuts。 */
  function dayWithCuts(cuts: number): DayRollup {
    const totalSamples = 1800
    const shots = cuts + 1
    const base = Math.floor(totalSamples / shots)
    const extra = totalSamples - base * shots
    const day = new Day()
    for (let index = 0; index < shots; index += 1) {
      const count = base + (index < extra ? 1 : 0)
      day.shot(`App${index}`, `window ${index}`, count * 2)
    }
    return day.rollup()
  }

  it.each([
    [0, '长镜头'],
    [2, '长镜头'],
    [3, '标准剪辑'],
    [7, '标准剪辑'],
    [8, '快切'],
    [20, '快切'],
    [21, '跳切风暴']
  ])('%i 次剪辑/小时判为 %s', (cuts, label) => {
    const day = dayWithCuts(cuts)
    expect(day.activeMs).toBe(3_600_000)
    expect(day.cuts).toBe(cuts)
    expect(day.appCuts).toBe(cuts)
    expect(day.withinAppCuts).toBe(0)
    expect(day.verdict.cutRate).toBe(cuts)
    expect(day.verdict.label).toBe(label)
  })
})

describe('searchScenes', () => {
  function wideDay(count: number): DayRollup {
    const day = new Day()
    for (let index = 0; index < count; index += 1) day.shot('Code', `note-${index}`, 4)
    return day.rollup()
  }

  it('不区分大小写地匹配标题与进程名', () => {
    const day = new Day().shot('Code', 'dayfilm - Visual Studio Code', 10).shot('Slack', '#general', 10).rollup()
    expect(searchScenes('DAYFILM', [day])).toHaveLength(1)
    expect(searchScenes('slack', [day])[0].title).toBe('#general')
    expect(searchScenes('code', [day]).map((scene) => scene.exe)).toEqual(['Code'])
    expect(searchScenes('VISUAL STUDIO', [day])).toHaveLength(1)
  })

  it('空查询返回空结果', () => {
    const day = wideDay(3)
    expect(searchScenes('', [day])).toEqual([])
    expect(searchScenes('   ', [day])).toEqual([])
  })

  it('结果按开始时间倒序，最多 200 条', () => {
    const hits = searchScenes('NOTE', [wideDay(260)])
    expect(hits).toHaveLength(200)
    expect(hits[0].start).toBeGreaterThan(hits[1].start)
    expect(hits[0].start).toBeGreaterThan(hits[hits.length - 1].start)
  })
})

describe('renderScreenplay', () => {
  it('写出标题行、题材汇总与镜头行', () => {
    const day = new Day().shot('Code', 'dayfilm - Visual Studio Code', 600).idle(120).rollup()
    const text = renderScreenplay(day)
    const lines = text.trimEnd().split('\n')
    expect(lines[0]).toBe(`# ${DATE} · Dayfilm 剧本`)
    expect(lines[1]).toBe('')
    expect(lines[2]).toContain(`题材：${day.verdict.label}`)
    expect(lines[2]).toContain('活跃 10 分钟')
    expect(text).toContain('- [09:00–09:10] Code · dayfilm - Visual Studio Code（10m）')
    expect(text).toContain('- [09:10–09:11] （中场休息 2m）')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('空的一天也有标题行与汇总', () => {
    const text = renderScreenplay(buildDayRollup([], DATE, T0))
    expect(text.startsWith(`# ${DATE} · Dayfilm 剧本\n\n`)).toBe(true)
    expect(text).toContain('0 个镜头')
  })

  it('有手记时写在标题行之后，没手记时不出现', () => {
    const day = new Day().shot('Code', 'dayfilm', 600).rollup()
    const lines = renderScreenplay(day, { note: '  今天收尾不错  ' }).trimEnd().split('\n')
    expect(lines[0]).toBe(`# ${DATE} · Dayfilm 剧本`)
    expect(lines[1]).toBe('')
    expect(lines[2]).toBe('> 导演手记：今天收尾不错')
    expect(lines[3]).toBe('')
    expect(lines[4]).toContain('题材：')

    expect(renderScreenplay(day).includes('导演手记')).toBe(false)
    expect(renderScreenplay(day, { note: '   ' }).includes('导演手记')).toBe(false)
  })

  it('项目命中时在题材段后加一行，取时长前 3', () => {
    const day = new Day()
      .shot('Code', 'dayfilm', 60)
      .shot('Slack', '#general', 120)
      .shot('Chrome', 'GitHub', 180)
      .shot('figma', 'design', 240)
      .rollup()
    const projects = [
      { name: '编码', terms: ['code'] },
      { name: '沟通', terms: ['slack'] },
      { name: '设计', terms: ['figma'] },
      { name: '其他', terms: ['chrome'] }
    ]
    const lines = renderScreenplay(day, { projects }).trimEnd().split('\n')
    const titleIndex = lines.findIndex((line) => line.startsWith('题材：'))
    expect(titleIndex).toBeGreaterThan(0)
    // 题材 → 正片/花絮 → 项目 → 空行 → 镜头行
    expect(lines[titleIndex + 1]).toBe('正片 10 分钟 · 花絮 0 分钟')
    expect(lines[titleIndex + 2]).toBe('项目：设计 4 分钟 · 其他 3 分钟 · 沟通 2 分钟')
    expect(lines[titleIndex + 3]).toBe('')
    // 镜头行格式不变
    expect(lines[titleIndex + 4]).toBe('- [09:00–09:01] Code · dayfilm（1m）')
  })

  it('没有项目命中、或没有规则时不出项目行', () => {
    const day = new Day().shot('Code', 'dayfilm', 600).rollup()
    expect(renderScreenplay(day, { projects: [] }).includes('项目：')).toBe(false)
    expect(renderScreenplay(day, { projects: [{ name: 'A', terms: ['nope'] }] }).includes('项目：')).toBe(false)
  })

  it('汇总段带正片/花絮时长', () => {
    const builder = new Day().shot('Code', 'dayfilm', 600)
    const base = builder.rollup()
    const extraStart = String(base.scenes[0].start)
    const marked = buildDayRollup(builder.samples, DATE, builder.now, { marks: { [extraStart]: 'extra' } })
    expect(renderScreenplay(marked)).toContain('正片 0 分钟 · 花絮 10 分钟')
    expect(renderScreenplay(base)).toContain('正片 10 分钟 · 花絮 0 分钟')
  })
})

describe('导演剪辑版标记', () => {
  it('标记写进镜头，正片 + 花絮 = 活跃时长', () => {
    const builder = new Day().shot('Code', 'dayfilm', 10).shot('Slack', '#general', 20)
    const plain = builder.rollup()
    const extraStart = String(plain.scenes[1].start)
    const marked = buildDayRollup(builder.samples, DATE, builder.now, { marks: { [extraStart]: 'extra' } })

    expect(marked.scenes[1].mark).toBe('extra')
    expect(marked.scenes[1].markSource).toBe('manual')
    expect(marked.scenes[0].mark).toBeUndefined()
    expect(marked.extraMs).toBe(plain.scenes[1].end - plain.scenes[1].start)
    expect(marked.featureMs).toBe(plain.scenes[0].end - plain.scenes[0].start)
    expect(marked.featureMs + marked.extraMs).toBe(marked.activeMs)
    // 标记不影响切分与题材
    expect(marked.cuts).toBe(plain.cuts)
    expect(marked.verdict).toEqual(plain.verdict)
  })

  it('未标记时全部算正片', () => {
    const rollup = new Day().shot('Code', 'dayfilm', 10).idle(120).rollup()
    expect(rollup.extraMs).toBe(0)
    expect(rollup.featureMs).toBe(rollup.activeMs)
    expect(rollup.scenes.every((scene) => scene.mark === undefined)).toBe(true)
  })

  it('显式标成正片也算正片', () => {
    const builder = new Day().shot('Code', 'dayfilm', 10)
    const start = String(builder.rollup().scenes[0].start)
    const marked = buildDayRollup(builder.samples, DATE, builder.now, { marks: { [start]: 'feature' } })
    expect(marked.scenes[0].mark).toBe('feature')
    expect(marked.scenes[0].markSource).toBe('manual')
    expect(marked.featureMs).toBe(marked.activeMs)
    expect(marked.extraMs).toBe(0)
  })

  it('对不上任何镜头的旧标记被忽略', () => {
    const builder = new Day().shot('Code', 'dayfilm', 10)
    const marked = buildDayRollup(builder.samples, DATE, builder.now, { marks: { '999': 'extra' } })
    expect(marked.extraMs).toBe(0)
    expect(marked.featureMs).toBe(marked.activeMs)
  })

  it('applyMarks 不改其它字段', () => {
    const rollup = new Day().shot('Code', 'dayfilm', 10).idle(120).rollup()
    const start = String(rollup.scenes[0].start)
    const marked = applyMarks(rollup, { [start]: 'extra' })
    expect(marked.date).toBe(rollup.date)
    expect(marked.idleMs).toBe(rollup.idleMs)
    expect(marked.scenes[1]).toBe(rollup.scenes[1])
    expect(marked.extraMs).toBe(rollup.scenes[0].end - rollup.scenes[0].start)
  })
})

describe('自动花絮规则', () => {
  it('isAutoExtra：严格小于阈值，等于不算', () => {
    expect(isAutoExtra(2800, 3)).toBe(true)
    // 3 秒正好：不算（镜头本来就以 3 秒起算）
    expect(isAutoExtra(3000, 3)).toBe(false)
    expect(isAutoExtra(3100, 3)).toBe(false)
    expect(isAutoExtra(9999, 10)).toBe(true)
    expect(isAutoExtra(10_000, 10)).toBe(false)
  })

  it('阈值 0 / 负数 / 非法值都表示关闭', () => {
    expect(isAutoExtra(1000, 0)).toBe(false)
    expect(isAutoExtra(1000, -5)).toBe(false)
    expect(isAutoExtra(1000, Number.NaN)).toBe(false)
  })

  it('buildDayRollup 带上阈值：短镜头变自动花絮，长镜头仍是正片', () => {
    const builder = new Day().shot('Code', 'dayfilm', 8).shot('Slack', '#general', 20)
    const rollup = buildDayRollup(builder.samples, DATE, builder.now, { autoExtraUnderSec: 10 })
    expect(rollup.scenes[0].mark).toBe('extra')
    expect(rollup.scenes[0].markSource).toBe('auto')
    expect(rollup.scenes[1].mark).toBeUndefined()
    expect(rollup.extraMs).toBe(8000)
    expect(rollup.featureMs).toBe(20_000)
    expect(rollup.featureMs + rollup.extraMs).toBe(rollup.activeMs)
  })

  it('正好等于阈值不算自动花絮', () => {
    const builder = new Day().shot('Code', 'dayfilm', 10)
    const rollup = buildDayRollup(builder.samples, DATE, builder.now, { autoExtraUnderSec: 10 })
    expect(rollup.scenes[0].mark).toBeUndefined()
    expect(rollup.extraMs).toBe(0)
    expect(rollup.featureMs).toBe(rollup.activeMs)
  })

  it('手动标记优先于自动规则', () => {
    const short = new Day().shot('Code', 'dayfilm', 8)
    const shortStart = String(short.rollup().scenes[0].start)
    const asFeature = buildDayRollup(short.samples, DATE, short.now, {
      marks: { [shortStart]: 'feature' },
      autoExtraUnderSec: 10
    })
    expect(asFeature.scenes[0].mark).toBe('feature')
    expect(asFeature.scenes[0].markSource).toBe('manual')
    expect(asFeature.extraMs).toBe(0)

    // 手动标花絮的长镜头，不会因为规则关闭而变回正片
    const long = new Day().shot('Code', 'dayfilm', 20)
    const longStart = String(long.rollup().scenes[0].start)
    const manualExtra = buildDayRollup(long.samples, DATE, long.now, { marks: { [longStart]: 'extra' } })
    expect(manualExtra.scenes[0].mark).toBe('extra')
    expect(manualExtra.scenes[0].markSource).toBe('manual')
    expect(manualExtra.extraMs).toBe(20_000)
  })

  it('关闭时行为与只传 marks 一致', () => {
    const builder = new Day().shot('Code', 'dayfilm', 8)
    const rollup = buildDayRollup(builder.samples, DATE, builder.now, { autoExtraUnderSec: 0 })
    expect(rollup.scenes[0].mark).toBeUndefined()
    expect(rollup.featureMs).toBe(rollup.activeMs)
    expect(rollup.extraMs).toBe(0)
  })

  it('中场休息不算自动花絮', () => {
    const builder = new Day().shot('Code', 'dayfilm', 8).idle(120)
    const rollup = buildDayRollup(builder.samples, DATE, builder.now, { autoExtraUnderSec: 30 })
    expect(rollup.scenes.filter((scene) => scene.kind === 'intermission')).toHaveLength(1)
    expect(rollup.scenes.some((scene) => scene.kind === 'intermission' && scene.mark !== undefined)).toBe(false)
  })
})
