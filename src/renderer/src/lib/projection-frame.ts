/**
 * 放映大画面的版式：这一帧是什么。纯参数，绘制层只照坐标画。
 * 场记板构图：背景大镜次、8% 起排的文本块、底部时长尺、3% 确定性颗粒。
 */
export interface ProjectionLine {
  text: string
  x: number
  y: number
  size: number
  family: 'display' | 'ui' | 'mono'
  opacity: number
  align: 'left' | 'right'
  maxWidth: number | null
}

/** 背景大数字：Bebas，高度 55%，右对齐、垂直居中。 */
export interface ProjectionBadge {
  text: string
  /** 右对齐的 x */
  x: number
  /** 垂直中心 */
  y: number
  size: number
  opacity: number
}

/** 底部时长尺：整幅宽基线 + 族色填充段。 */
export interface ProjectionRuler {
  y: number
  x0: number
  x1: number
  /** 族色填充宽度 = ratio × (x1 − x0) */
  fill: number
  ratio: number
}

/** 确定性颗粒：复用剧照噪声的点表，数量 = 面积 × 3%。 */
export interface ProjectionGrain {
  seed: number
  count: number
  opacity: number
}

export interface ProjectionFrameParams {
  width: number
  height: number
  hue: number
  /** 左侧族色条宽度 */
  sideBar: number
  /** 顶部发丝线 y 与水平范围 */
  top: { y: number; x0: number; x1: number }
  bottom: { y: number; x0: number; x1: number }
  /** 暗角强度（0–1） */
  vignette: number
  bigNumber: ProjectionBadge
  ruler: ProjectionRuler
  grain: ProjectionGrain
  lines: ProjectionLine[]
}

export interface ProjectionFrameInput {
  date: string
  /** 当天第几镜（1 开始） */
  shot: number
  total: number
  exe: string
  title: string
  /** 应用族色相 */
  hue: number
  /** 是否画左侧族色条（中场休息不画） */
  showBar?: boolean
  start: number
  end: number
  seconds: number
  /** 当天最长镜头的秒数（时长尺的分母） */
  maxSeconds: number
  /** 颗粒种子：镜头 id 的哈希，保证同一天同一镜颗粒不变 */
  grainSeed: number
  width: number
  height: number
}

function pad2(value: number): string {
  return String(Math.trunc(value)).padStart(2, '0')
}

function clock(ts: number): string {
  const date = new Date(ts)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function duration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  if (minutes < 60) return rest === 0 ? `${minutes} 分` : `${minutes} 分 ${pad2(rest)} 秒`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${pad2(minutes % 60)} 分`
}

export function projectionFrameParams(input: ProjectionFrameInput): ProjectionFrameParams {
  const width = Math.max(1, Math.round(input.width))
  const height = Math.max(1, Math.round(input.height))
  const textX = Math.round(width * 0.08)
  const rightX = width - textX
  const margin = Math.max(28, Math.round(height * 0.09))
  const monoSize = Math.max(10, Math.round(width / 90))
  const labelSize = 9
  const nameSize = Math.min(40, Math.max(28, Math.round(width / 24)))
  const titleSize = Math.max(11, Math.round(width / 80))
  const shot = Math.max(1, Math.round(input.shot))
  const total = Math.max(1, Math.round(input.total))
  const nameY = Math.round(height * 0.52)
  const ratio = Math.min(1, Math.max(0, input.seconds / Math.max(1, input.maxSeconds)))
  const rulerY = Math.round(height - height * 0.045)

  const lines: ProjectionLine[] = [
    {
      text: `${input.date} · SHOT ${pad2(shot)} / ${pad2(total)}`,
      x: textX,
      y: margin + monoSize + 8,
      size: monoSize,
      family: 'mono',
      opacity: 0.45,
      align: 'left',
      maxWidth: rightX - textX
    },
    {
      text: input.exe.toUpperCase(),
      x: textX,
      y: nameY,
      size: nameSize,
      family: 'display',
      opacity: 1,
      align: 'left',
      maxWidth: rightX - textX
    },
    {
      text: input.title,
      x: textX,
      y: nameY + Math.round(nameSize * 0.55) + titleSize + 4,
      size: titleSize,
      family: 'ui',
      opacity: 0.55,
      align: 'left',
      maxWidth: rightX - textX
    },
    {
      text: `${clock(input.start)}–${clock(input.end)}`,
      x: textX,
      y: height - margin - monoSize - 6,
      size: monoSize,
      family: 'mono',
      opacity: 0.5,
      align: 'left',
      maxWidth: null
    },
    {
      text: `${duration(input.seconds)} / ${duration(input.maxSeconds)}`,
      x: rightX,
      y: rulerY - 8,
      size: labelSize,
      family: 'mono',
      opacity: 0.5,
      align: 'right',
      maxWidth: null
    }
  ]

  return {
    width,
    height,
    hue: input.hue,
    sideBar: input.showBar === false ? 0 : Math.max(3, Math.round(width / 220)),
    top: { y: margin, x0: textX, x1: rightX },
    bottom: { y: height - margin, x0: textX, x1: rightX },
    vignette: 0.06,
    bigNumber: {
      text: String(shot),
      x: rightX,
      y: Math.round(height / 2),
      size: Math.round(height * 0.55),
      opacity: 0.04
    },
    ruler: { y: rulerY, x0: 0, x1: width, fill: Math.round((width - 0) * ratio), ratio },
    grain: {
      seed: Math.round(input.grainSeed),
      count: Math.max(1, Math.round(width * height * 0.03)),
      opacity: 1
    },
    lines
  }
}
