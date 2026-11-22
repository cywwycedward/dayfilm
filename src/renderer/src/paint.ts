/** Canvas 绘制：程序化剧照、胶片、周视图迷你条、海报。只在这里碰 canvas 2D 上下文。 */
import type { PosterLayout } from './lib/poster'
import type { ReelRect } from './lib/zoom'
import { unitAt } from './lib/hash'
import { stillSpec, type StillSpec } from './lib/still'

export interface StillBox {
  x: number
  y: number
  w: number
  h: number
}

const TAU = Math.PI * 2

/** 一块带剧组气质的画面：渐变底 + 漏光 + 由哈希决定的几何。 */
export function paintStill(ctx: CanvasRenderingContext2D, box: StillBox, spec: StillSpec): void {
  const { x, y, w, h } = box
  if (!(w > 0) || !(h > 0)) return
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()

  const base = ctx.createLinearGradient(
    x,
    y,
    x + Math.cos(spec.angle) * w,
    y + Math.sin(spec.angle) * h
  )
  base.addColorStop(0, `hsl(${spec.hue} 38% 33%)`)
  base.addColorStop(0.52, `hsl(${(spec.hue + 20) % 360} 34% 20%)`)
  base.addColorStop(1, `hsl(${spec.hue} 28% 12%)`)
  ctx.fillStyle = base
  ctx.fillRect(x, y, w, h)

  // 漏光：来自画面一角，像放映机没遮严的散光
  const lx = x + w * (0.1 + unitAt(spec.seed, 11) * 0.8)
  const ly = y + h * (0.1 + unitAt(spec.seed, 12) * 0.8)
  const leak = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.max(w, h) * 0.9)
  leak.addColorStop(0, `hsl(${spec.hueAccent} 48% 62% / 0.26)`)
  leak.addColorStop(1, `hsl(${spec.hueAccent} 48% 62% / 0)`)
  ctx.fillStyle = leak
  ctx.fillRect(x, y, w, h)

  if (spec.shape === 'lines') {
    ctx.strokeStyle = `hsl(${spec.hueAccent} 40% 72% / 0.2)`
    ctx.lineWidth = Math.max(1, h * 0.008)
    const spreadX = Math.cos(spec.angle + Math.PI / 2) * w
    const spreadY = Math.sin(spec.angle + Math.PI / 2) * h
    for (let i = 1; i <= spec.bands; i += 1) {
      const t = i / (spec.bands + 1)
      ctx.beginPath()
      ctx.moveTo(x + w * t - spreadX, y + h * t - spreadY)
      ctx.lineTo(x + w * t + spreadX, y + h * t + spreadY)
      ctx.stroke()
    }
  } else if (spec.shape === 'rings') {
    const cx = x + w * (0.28 + unitAt(spec.seed, 21) * 0.44)
    const cy = y + h * (0.32 + unitAt(spec.seed, 22) * 0.36)
    ctx.strokeStyle = `hsl(${spec.hueAccent} 42% 70% / 0.18)`
    ctx.lineWidth = Math.max(1, h * 0.006)
    for (let i = 1; i <= spec.bands; i += 1) {
      ctx.beginPath()
      ctx.arc(cx, cy, ((Math.min(w, h) * 0.72) / spec.bands) * i, 0, TAU)
      ctx.stroke()
    }
  } else if (spec.shape === 'bars') {
    const barWidth = w / (spec.bands * 2.4)
    for (let i = 0; i < spec.bands; i += 1) {
      const bx = x + w * ((i + 0.5) / spec.bands) - barWidth / 2
      ctx.fillStyle = `hsl(${(spec.hueAccent + i * 6) % 360} 40% 66% / ${
        0.05 + unitAt(spec.seed, 30 + i) * 0.09
      })`
      ctx.fillRect(bx, y, barWidth, h)
    }
  } else {
    const inset = Math.max(2, h * 0.13)
    ctx.strokeStyle = `hsl(${spec.hueAccent} 38% 70% / 0.22)`
    ctx.lineWidth = Math.max(1, h * 0.01)
    ctx.strokeRect(x + inset, y + inset, Math.max(0, w - inset * 2), Math.max(0, h - inset * 2))
    ctx.beginPath()
    ctx.moveTo(x + w * 0.06, y + h * 0.94)
    ctx.lineTo(x + w * 0.94, y + h * 0.06)
    ctx.stroke()
  }

  const shade = ctx.createLinearGradient(x, y + h * 0.55, x, y + h)
  shade.addColorStop(0, 'rgba(6, 7, 9, 0)')
  shade.addColorStop(1, 'rgba(6, 7, 9, 0.28)')
  ctx.fillStyle = shade
  ctx.fillRect(x, y, w, h)
  ctx.restore()
}

function paintIntermission(
  ctx: CanvasRenderingContext2D,
  x: number,
  w: number,
  h: number
): void {
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, 0, w, h)
  ctx.clip()
  ctx.fillStyle = '#12151b'
  ctx.fillRect(x, 0, w, h)
  ctx.strokeStyle = 'rgba(236, 231, 223, 0.09)'
  ctx.lineWidth = 1
  for (let offset = -h; offset < w + h; offset += 8) {
    ctx.beginPath()
    ctx.moveTo(x + offset, h)
    ctx.lineTo(x + offset + h, 0)
    ctx.stroke()
  }
  ctx.restore()
}

/** 整卷胶片：留白表现空隙，斜纹表现中场休息。只在数据或选中变化时重画。 */
export interface ReelPaintOptions {
  selectedId: string | null
  /** 首个有素材镜头的左边界（像素）；当天无镜头时传整条宽度 */
  materialStartX: number
  /** 最后一个镜头的右边界（像素）；当天无镜头时传 0 */
  materialEndX: number
  /** 今天"现在"的像素位置；历史日传 -1 */
  nowX: number
}

/** 没拍到的时段：低对比度点阵，读得出是"空胶片"而不是渲染失败。 */
function paintNoFootage(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  height: number
): void {
  const left = Math.max(0, Math.round(x0))
  const right = Math.round(x1)
  if (right - left < 10) return
  ctx.fillStyle = 'rgba(236, 231, 223, 0.08)'
  for (let x = Math.ceil(left / 15) * 15; x < right; x += 15) {
    for (let y = 7; y < height - 6; y += 11) {
      ctx.fillRect(x, y, 2, 1)
    }
  }
}

/** 今天"现在"之后：更暗，并且按小时留出空白的竖线节奏，与无采样点阵区分。 */
function paintFuture(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  width: number,
  height: number
): void {
  const left = Math.max(0, Math.round(x0))
  const right = Math.round(x1)
  if (right - left < 4) return
  ctx.fillStyle = '#040508'
  ctx.fillRect(left, 0, right - left, height)
  const hourPx = width / 24
  ctx.fillStyle = 'rgba(236, 231, 223, 0.045)'
  for (let hour = 1; hour < 24; hour += 1) {
    const x = hour * hourPx
    if (x > left + 3 && x < right - 3) ctx.fillRect(Math.round(x), 6, 1, height - 12)
  }
}

export function paintReel(
  ctx: CanvasRenderingContext2D,
  rects: readonly ReelRect[],
  width: number,
  height: number,
  options: ReelPaintOptions
): void {
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#07080a'
  ctx.fillRect(0, 0, width, height)

  paintNoFootage(ctx, 0, options.materialStartX, height)
  if (options.nowX >= 0) paintFuture(ctx, options.nowX, width, width, height)
  else paintNoFootage(ctx, options.materialEndX, width, height)

  for (const rect of rects) {
    const w = Math.max(1.5, rect.x1 - rect.x0)
    if (rect.scene.kind === 'intermission') {
      paintIntermission(ctx, rect.x0, w, height)
    } else {
      paintStill(ctx, { x: rect.x0, y: 0, w, h: height }, stillSpec(rect.scene.exe, rect.scene.title))
    }
  }

  ctx.fillStyle = 'rgba(6, 7, 9, 0.92)'
  for (const rect of rects) {
    ctx.fillRect(rect.x0 - 0.5, 0, 1, height)
  }

  const selected = rects.find((rect) => rect.scene.id === options.selectedId)
  if (selected) {
    const w = Math.max(2, selected.x1 - selected.x0)
    ctx.strokeStyle = 'rgba(240, 196, 128, 0.95)'
    ctx.lineWidth = 2
    ctx.strokeRect(selected.x0 + 1, 1, Math.max(1, w - 2), height - 2)
  }
}

const stillCache = new Map<string, string>()

/** 缩略图与放大帧共用的剧照位图，同一 (exe, title) 只画一次。 */
export function stillDataUrl(exe: string, title: string): string {
  const key = `${exe}|${title}`
  const cached = stillCache.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 72
  const ctx = canvas.getContext('2d')
  if (ctx) paintStill(ctx, { x: 0, y: 0, w: 128, h: 72 }, stillSpec(exe, title))
  const url = canvas.toDataURL('image/png')
  if (stillCache.size > 512) stillCache.clear()
  stillCache.set(key, url)
  return url
}

/** 按设备像素比重设画布尺寸，返回已缩放到 CSS 像素的上下文。 */
export function sizeCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): CanvasRenderingContext2D | null {
  const ratio = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = Math.max(1, Math.round(width * ratio))
  canvas.height = Math.max(1, Math.round(height * ratio))
  const ctx = canvas.getContext('2d')
  ctx?.setTransform(ratio, 0, 0, ratio, 0, 0)
  return ctx
}

/** 周视图的一格：24 个小时柱，越活跃越亮。 */
export function paintWeekBars(
  ctx: CanvasRenderingContext2D,
  buckets: readonly number[],
  width: number,
  height: number
): void {
  ctx.clearRect(0, 0, width, height)
  const slot = width / Math.max(1, buckets.length)
  buckets.forEach((level, index) => {
    const x = index * slot
    const w = Math.max(1, slot - 1)
    if (level <= 0) {
      ctx.fillStyle = 'rgba(236, 231, 223, 0.06)'
      ctx.fillRect(x, height - 3, w, 3)
      return
    }
    ctx.fillStyle = `rgba(240, 196, 128, ${0.2 + level * 0.75})`
    ctx.fillRect(x, 2, w, height - 5)
  })
}

const POSTER_TONES: Record<string, string> = {
  display: '#ece7df',
  title: '#ece7df',
  label: '#a8a29a',
  body: '#c9c3ba',
  muted: '#8a847c',
  accent: '#f0c480'
}

/** 1600×1000 的海报：背景、胶片缩略、文字与横条，都按 layout 里算好的坐标画。 */
export function paintPoster(ctx: CanvasRenderingContext2D, layout: PosterLayout): void {
  const { width, height } = layout
  ctx.clearRect(0, 0, width, height)
  const backdrop = ctx.createLinearGradient(0, 0, width * 0.4, height)
  backdrop.addColorStop(0, '#0d0f14')
  backdrop.addColorStop(0.55, '#08090c')
  backdrop.addColorStop(1, '#05060a')
  ctx.fillStyle = backdrop
  ctx.fillRect(0, 0, width, height)

  const glow = ctx.createRadialGradient(180, -80, 0, 180, -80, 900)
  glow.addColorStop(0, 'rgba(240, 196, 128, 0.16)')
  glow.addColorStop(1, 'rgba(240, 196, 128, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, width, height)

  const film = layout.film
  ctx.fillStyle = '#07080a'
  ctx.fillRect(film.x, film.y, film.w, film.h)
  ctx.save()
  ctx.beginPath()
  ctx.rect(film.x, film.y, film.w, film.h)
  ctx.clip()
  for (const still of layout.stills) {
    paintStill(ctx, still, stillSpec(still.exe, still.title))
  }
  ctx.restore()
  ctx.strokeStyle = 'rgba(236, 231, 223, 0.12)'
  ctx.lineWidth = 1
  ctx.strokeRect(film.x + 0.5, film.y + 0.5, film.w - 1, film.h - 1)

  ctx.textBaseline = 'alphabetic'
  for (const text of layout.texts) {
    ctx.fillStyle = POSTER_TONES[text.tone] ?? POSTER_TONES.body
    ctx.font = `${text.weight} ${text.size}px 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif`
    ctx.fillText(text.text, text.x, text.y)
  }

  for (const row of layout.rows) {
    ctx.font = `500 20px 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif`
    ctx.fillStyle = '#c9c3ba'
    ctx.fillText(row.label, row.x, row.y)
    ctx.textAlign = 'right'
    ctx.fillStyle = '#8a847c'
    ctx.font = `500 18px 'Cascadia Mono', Consolas, monospace`
    ctx.fillText(row.value, row.bar.x + row.bar.w, row.y)
    ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(236, 231, 223, 0.08)'
    ctx.fillRect(row.bar.x, row.bar.y, row.bar.w, row.bar.h)
    ctx.fillStyle = 'rgba(240, 196, 128, 0.72)'
    const level = Math.max(0, Math.min(1, row.bar.level))
    ctx.fillRect(row.bar.x, row.bar.y, row.bar.w * level, row.bar.h)
  }

  const note = layout.note
  if (note) {
    ctx.font = `400 ${note.size}px 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif`
    ctx.fillStyle = '#c9c3ba'
    note.lines.forEach((line, index) => {
      ctx.fillText(line, note.x, note.y + index * note.lineHeight)
    })
  }
}
