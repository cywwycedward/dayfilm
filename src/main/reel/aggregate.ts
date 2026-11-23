import type { DayRollup, Sample, Scene, SceneKind, TopApp } from '../../shared/types'
import { orderSamples } from './index'
import { GAP_MS, HOUR_MS, IDLE_MS, MIN_ACTIVE_MS, MIN_SHOT_MS, SAMPLE_MS, judge } from './rules'

interface RunState {
  kind: SceneKind
  exe: string
  title: string
  firstT: number
  lastT: number
}

interface Sealed {
  scene: Scene
  ms: number
}

/**
 * 当日采样流的增量聚合。只处理尾部：新采样若延续当前区间就改 `lastT`，否则封存上一段。
 * 结果必须与 `buildDayRollup` 深度相等——`tests/main/aggregate.test.ts` 用 200 组随机序列守着。
 *
 * 前提：`append` 的时间严格递增（运行时由时钟守卫保证）。乱序时返回 false，调用方应整体重建。
 */
export class DayAggregator {
  private readonly scenes: Scene[] = []
  private open: RunState | null = null
  private firstAt: number | null = null
  private lastT: number | null = null
  private activeMs = 0
  private idleMs = 0
  private cuts = 0
  private lastShotExe: string | null = null
  private lastShotTitle: string | null = null
  private longest: Sealed | null = null
  private readonly totals = new Map<string, number>()

  constructor(private readonly date: string) {}

  /** 用已有采样全量建索引（当日首次加载时走这里）。 */
  static fromSamples(samples: readonly Sample[], date: string): DayAggregator {
    const aggregator = new DayAggregator(date)
    for (const sample of orderSamples(samples)) aggregator.append(sample)
    return aggregator
  }

  get lastSampleT(): number | null {
    return this.lastT
  }

  get sceneCount(): number {
    return this.scenes.length
  }

  append(sample: Sample): boolean {
    if (this.lastT !== null && sample.t <= this.lastT) return false
    const kind: SceneKind = sample.idleMs >= IDLE_MS ? 'intermission' : 'shot'
    const open = this.open
    if (open) {
      const sameWindow = kind === 'intermission' || (open.exe === sample.exe && open.title === sample.title)
      if (open.kind === kind && sameWindow && sample.t - open.lastT <= GAP_MS) {
        open.lastT = sample.t
        this.lastT = sample.t
        return true
      }
      this.seal(open, sample.t)
    }
    this.open = {
      kind,
      exe: kind === 'shot' ? sample.exe : '',
      title: kind === 'shot' ? sample.title : '',
      firstT: sample.t,
      lastT: sample.t
    }
    if (this.firstAt === null) this.firstAt = sample.t
    this.lastT = sample.t
    return true
  }

  /** 生成汇总。`now` 只影响仍未封存的尾部镜头，代价与镜头数同阶、与采样数无关。 */
  rollup(now: number): DayRollup {
    const tail = this.open ? this.sealView(this.open, now) : null
    let activeMs = this.activeMs
    let idleMs = this.idleMs
    let cuts = this.cuts
    let longest = this.longest
    if (tail) {
      if (tail.scene.kind === 'shot') {
        activeMs += tail.ms
        if (this.lastShotExe !== null && (this.lastShotExe !== tail.scene.exe || this.lastShotTitle !== tail.scene.title)) {
          cuts += 1
        }
        if (!longest || tail.ms > longest.ms) longest = tail
      } else {
        idleMs += tail.ms
      }
    }

    const totals = new Map(this.totals)
    if (tail && tail.scene.kind === 'shot') {
      totals.set(tail.scene.exe, (totals.get(tail.scene.exe) ?? 0) + tail.ms)
    }
    const topApps: TopApp[] = [...totals.entries()]
      .map(([exe, ms]) => ({ exe, ms }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 5)
      .map(({ exe, ms }) => ({ exe, seconds: Math.round(ms / 1000) }))

    const cutRate = cuts / Math.max(activeMs / HOUR_MS, MIN_ACTIVE_MS)
    return {
      date: this.date,
      firstAt: this.firstAt,
      lastAt: this.lastT,
      activeMs,
      idleMs,
      scenes: tail ? [...this.scenes, tail.scene] : this.scenes.slice(),
      cuts,
      longestShot: longest ? longest.scene : null,
      topApps,
      verdict: judge(cutRate, longest),
      // 这里只算未标记的基线；标记由 DayCache 用 applyMarks 覆盖上去
      featureMs: activeMs,
      extraMs: 0
    }
  }

  private seal(run: RunState, nextStart: number): void {
    const sealed = this.sealView(run, nextStart)
    if (sealed) this.push(sealed)
  }

  /** 区间 → 镜头。不修改状态，供 `rollup` 推演尾部镜头。 */
  private sealView(run: RunState, nextStart: number): Sealed | null {
    const end =
      run.kind === 'intermission' ? run.lastT : Math.max(run.firstT, Math.min(run.lastT + SAMPLE_MS, nextStart))
    const ms = end - run.firstT
    if (run.kind === 'shot' ? ms < MIN_SHOT_MS : ms <= 0) return null
    return {
      ms,
      scene: {
        id: `${this.date}-${this.scenes.length + 1}`,
        start: run.firstT,
        end,
        exe: run.exe,
        title: run.title,
        seconds: Math.round(ms / 1000),
        kind: run.kind
      }
    }
  }

  private push(sealed: Sealed): void {
    const { scene, ms } = sealed
    this.scenes.push(scene)
    if (scene.kind === 'shot') {
      this.activeMs += ms
      if (this.lastShotExe !== null && (this.lastShotExe !== scene.exe || this.lastShotTitle !== scene.title)) {
        this.cuts += 1
      }
      this.lastShotExe = scene.exe
      this.lastShotTitle = scene.title
      this.totals.set(scene.exe, (this.totals.get(scene.exe) ?? 0) + ms)
      if (!this.longest || ms > this.longest.ms) this.longest = sealed
    } else {
      this.idleMs += ms
    }
  }
}
