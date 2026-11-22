/**
 * 剧照（场记板式的一帧）的纯参数。视觉权威见 docs/product/visual-language.md §4。
 * 这里只算"画什么、画多大、放在哪"，不碰 canvas。
 */
import type { SceneKind } from '../../../shared/types'
import { hashString, unitAt } from './hash'
import { exeHue } from './still'

export type StillTier = 'full' | 'compact' | 'sliver'
export type StillFamily = 'display' | 'ui' | 'mono'

export const FULL_MIN_WIDTH = 120
export const FULL_MIN_HEIGHT = 64
export const COMPACT_MIN_WIDTH = 56

/** 服务尺寸：完整帧与紧凑帧都按目标尺寸参数化，不再缩绘固定位图。 */

export interface StillInput {
  exe: string
  title: string
  kind: SceneKind
  /** 当天第几镜（1 开始；中场休息为 0） */
  index: number
  /** 本地日期，参与颗粒种子 */
  date: string
  width: number
  height: number
}

export interface StillLine {
  text: string
  x: number
  y: number
  size: number
  weight: number
  family: StillFamily
  opacity: number
  align: 'left' | 'right'
  /** 超过这个宽度就截断加省略号（绘制层用 measureText） */
  maxWidth: number | null
}

export interface StillHole {
  x: number
  y: number
  w: number
  h: number
}

export interface StillParams {
  tier: StillTier
  width: number
  height: number
  index: number
  intermission: boolean
  /** 应用族色相（0–359） */
  hue: number
  seed: number
  /** 完整帧左侧 3px 族色条 */
  sideBar: { w: number; visible: boolean } | null
  /** 紧凑帧顶部 2px 族色条 */
  topBar: { h: number; visible: boolean } | null
  /** 齿孔带的上下高度；0 表示不画 */
  bandTop: number
  bandBottom: number
  holes: StillHole[]
  border: boolean
  hatch: { spacing: number; alpha: number } | null
  grain: { seed: number; count: number } | null
  sliver: { fillAlpha: number; highlightH: number } | null
  lines: StillLine[]
}

export function stillTier(width: number, height: number): StillTier {
  if (width >= FULL_MIN_WIDTH && height >= FULL_MIN_HEIGHT) return 'full'
  if (width >= COMPACT_MIN_WIDTH) return 'compact'
  return 'sliver'
}

/** 应用族色：12 个色相带，固定低饱和。同一进程永远同色。 */
export function familyColor(hue: number, alpha = 1): string {
  return alpha >= 1 ? `hsl(${hue} 24% 38%)` : `hsl(${hue} 24% 38% / ${alpha})`
}

/** 当天镜头序号（只数 shot，中场休息不占号）。 */
export function shotOrdinals(scenes: readonly { id: string; kind: SceneKind }[]): Map<string, number> {
  const ordinals = new Map<string, number>()
  let shot = 0
  for (const scene of scenes) {
    if (scene.kind !== 'shot') continue
    shot += 1
    ordinals.set(scene.id, shot)
  }
  return ordinals
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/** 完整帧的齿孔：上下各一条带，孔距与孔尺寸随帧高缩放。 */
function perforations(
  width: number,
  bandTop: number,
  bandBottom: number,
  height: number,
  holeW: number,
  holeH: number,
  gap: number
): StillHole[] {
  if (bandTop <= 0 && bandBottom <= 0) return []
  const holes: StillHole[] = []
  for (let x = Math.round(gap / 2); x + holeW <= width - Math.round(gap / 2); x += gap) {
    if (bandTop > 0) holes.push({ x, y: Math.round((bandTop - holeH) / 2), w: holeW, h: holeH })
    if (bandBottom > 0) {
      holes.push({ x, y: height - Math.round((bandBottom + holeH) / 2), w: holeW, h: holeH })
    }
  }
  return holes
}

export function stillParams(input: StillInput): StillParams {
  const width = Math.max(1, Math.round(input.width))
  const height = Math.max(1, Math.round(input.height))
  const tier = stillTier(width, height)
  const intermission = input.kind === 'intermission'
  const hue = exeHue(input.exe)
  const seed = hashString(`${input.date}|${input.index}|${input.exe}|${input.title}`)
  const index = Math.max(0, Math.round(input.index))

  if (tier === 'sliver') {
    return {
      tier,
      width,
      height,
      index,
      intermission,
      hue,
      seed,
      sideBar: null,
      topBar: null,
      bandTop: 0,
      bandBottom: 0,
      holes: [],
      border: false,
      hatch: null,
      grain: null,
      sliver: { fillAlpha: 0.35, highlightH: 2 },
      lines: []
    }
  }

  if (tier === 'compact') {
    const nameSize = clamp(Math.round(width / 14), 12, 16)
    const lines: StillLine[] = [
      {
        text: intermission ? '中场休息' : input.exe.toUpperCase(),
        x: 8,
        y: Math.round(height * 0.58),
        size: nameSize,
        weight: 400,
        family: 'display',
        opacity: 1,
        align: 'left',
        maxWidth: width - 16
      }
    ]
    if (index > 0) {
      lines.push({
        text: `#${String(index).padStart(2, '0')}`,
        x: width - 6,
        y: height - 6,
        size: 9,
        weight: 400,
        family: 'mono',
        opacity: 0.4,
        align: 'right',
        maxWidth: null
      })
    }
    return {
      tier,
      width,
      height,
      index,
      intermission,
      hue,
      seed,
      sideBar: null,
      topBar: { h: 2, visible: !intermission },
      bandTop: 0,
      bandBottom: 0,
      holes: [],
      border: true,
      hatch: intermission ? { spacing: 6, alpha: 0.16 } : null,
      grain: null,
      sliver: null,
      lines
    }
  }

  // 完整帧按 288px 高的基准等比缩放（大画面才会像"放大的一帧"），小尺寸有下限
  const s = height / 288
  const band = Math.max(5, Math.round(5 * s))
  const pad = Math.max(8, Math.round(14 * s))
  const nameSize = Math.max(18, Math.round(24 * s))
  const titleSize = Math.max(10, Math.round(10 * s))
  const monoSize = Math.max(9, Math.round(9 * s))
  const holeW = Math.max(6, Math.round(6 * s))
  const holeH = Math.max(3, Math.round(3 * s))
  const holeGap = Math.max(14, Math.round(14 * s))
  const nameY = Math.round(height * 0.46)
  const lines: StillLine[] = [
    {
      text: intermission ? '中场休息' : input.exe.toUpperCase(),
      x: pad,
      y: nameY,
      size: nameSize,
      weight: 400,
      family: 'display',
      opacity: 1,
      align: 'left',
      maxWidth: width - pad * 2
    },
    {
      text: input.title,
      x: pad,
      y: nameY + Math.round(nameSize * 0.7) + Math.max(4, Math.round(6 * s)),
      size: titleSize,
      weight: 400,
      family: 'ui',
      opacity: 0.55,
      align: 'left',
      maxWidth: width - pad * 2
    },
    {
      text: `${input.date.slice(5)} · 镜 ${index}`,
      x: pad,
      y: height - band - Math.max(6, Math.round(8 * s)),
      size: monoSize,
      weight: 400,
      family: 'mono',
      opacity: 0.55,
      align: 'left',
      maxWidth: width - pad * 2
    }
  ]
  if (index > 0) {
    lines.push({
      text: `#${String(index).padStart(2, '0')}`,
      x: width - pad,
      y: band + Math.max(8, Math.round(12 * s)),
      size: monoSize,
      weight: 400,
      family: 'mono',
      opacity: 0.4,
      align: 'right',
      maxWidth: null
    })
  }
  return {
    tier,
    width,
    height,
    index,
    intermission,
    hue,
    seed,
    sideBar: { w: Math.max(3, Math.round(3 * s)), visible: !intermission },
    topBar: null,
    bandTop: intermission ? 0 : band,
    bandBottom: intermission ? 0 : band,
    holes: intermission ? [] : perforations(width, band, band, height, holeW, holeH, holeGap),
    border: true,
    hatch: intermission ? { spacing: 6, alpha: 0.16 } : null,
    grain: intermission ? null : { seed, count: Math.round((width * height) / 160) },
    sliver: null,
    lines
  }
}

/** 颗粒：确定性噪声点（由 seed 决定位置与亮度）。 */
export function grainPoints(seed: number, count: number, width: number, height: number): { x: number; y: number; a: number }[] {
  const points: { x: number; y: number; a: number }[] = []
  for (let i = 0; i < count; i += 1) {
    const x = Math.floor(unitAt(seed, i * 3 + 1) * width)
    const y = Math.floor(unitAt(seed, i * 3 + 2) * height)
    const a = unitAt(seed, i * 3 + 3) > 0.5 ? 0.04 : 0.02
    points.push({ x, y, a })
  }
  return points
}
