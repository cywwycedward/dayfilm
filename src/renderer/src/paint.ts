/** 胶片、周视图迷你条、海报的绘制。剧照本体在 paint-still.ts，这里只摆位置。 */
import type { PosterLayout, PosterPalette } from './lib/poster'
import type { ReelRect } from './lib/zoom'
import { drawStill, paintProjectionBoard } from './paint-still'
import { familyColor } from './lib/still-frame'
import { projectionFrameParams } from './lib/projection-frame'

export interface ReelPaintOptions {
  selectedId: string | null
  /** 首个有素材镜头的左边界（像素）；当天无镜头时传整条宽度 */
  materialStartX: number
  /** 最后一个镜头的右边界（像素）；当天无镜头时传 0 */
  materialEndX: number
  /** 今天"现在"的像素位置；历史日传 -1 */
  nowX: number
  /** 当天日期，参与剧照颗粒种子 */
  date: string
  /** 镜头 id → 当天镜次 */
  ordinals: ReadonlyMap<string, number>
}

/** 没拍到的时段：纸色点阵，读得出是"空胶片"而不是渲染失败。 */
function paintNoFootage(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  height: number
): void {
  const left = Math.max(0, Math.round(x0))
  const right = Math.round(x1)
  if (right - left < 10) return
  ctx.fillStyle = 'rgba(236, 231, 220, 0.07)'
  for (let x = Math.ceil(left / 15) * 15; x < right; x += 15) {
    for (let y = 7; y < height - 6; y += 11) {
      ctx.fillRect(x, y, 1, 1)
    }
  }
}

/** 今天"现在"之后：更暗，并且按小时留出竖线节奏，与无采样点阵区分。 */
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
  ctx.fillStyle = '#0c0d11'
  ctx.fillRect(left, 0, right - left, height)
  const hourPx = width / 24
  ctx.fillStyle = 'rgba(236, 231, 220, 0.04)'
  for (let hour = 1; hour < 24; hour += 1) {
    const x = hour * hourPx
    if (x > left + 3 && x < right - 3) ctx.fillRect(Math.round(x), 6, 1, height - 12)
  }
}

/** 整卷胶片：每段是同一份剧照位图的缩绘，留白表现无采样。 */
export function paintReel(
  ctx: CanvasRenderingContext2D,
  rects: readonly ReelRect[],
  width: number,
  height: number,
  options: ReelPaintOptions
): void {
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#0a0b0d'
  ctx.fillRect(0, 0, width, height)

  paintNoFootage(ctx, 0, options.materialStartX, height)
  if (options.nowX >= 0) paintFuture(ctx, options.nowX, width, width, height)
  else paintNoFootage(ctx, options.materialEndX, width, height)

  for (const rect of rects) {
    const w = Math.max(1.5, rect.x1 - rect.x0)
    drawStill(
      ctx,
      rect.scene,
      options.ordinals.get(rect.scene.id) ?? 0,
      options.date,
      rect.x0,
      0,
      w,
      height
    )
  }

  ctx.fillStyle = 'rgba(10, 11, 13, 0.9)'
  for (const rect of rects) {
    ctx.fillRect(rect.x0 - 0.5, 0, 1, height)
  }

  const selected = rects.find((rect) => rect.scene.id === options.selectedId)
  if (selected) {
    const w = Math.max(2, selected.x1 - selected.x0)
    ctx.strokeStyle = 'rgba(236, 231, 220, 0.9)'
    ctx.lineWidth = 1
    ctx.strokeRect(selected.x0 + 0.5, 0.5, Math.max(1, w - 1), height - 1)
  }
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

/** 素材密度直方图：柱高 = 该 10 分钟内的活跃占比；没有素材的桶画 2px 底纹。 */
export function paintDensity(
  ctx: CanvasRenderingContext2D,
  bars: readonly { x0: number; x1: number; level: number; empty: boolean }[],
  width: number,
  height: number
): void {
  ctx.clearRect(0, 0, width, height)
  for (const bar of bars) {
    const w = Math.max(1, bar.x1 - bar.x0 - 0.5)
    if (bar.empty) {
      ctx.fillStyle = 'rgba(236, 231, 220, 0.07)'
      ctx.fillRect(bar.x0, height - 2, w, 2)
      continue
    }
    const h = Math.max(1, Math.round(bar.level * (height - 3)))
    ctx.fillStyle = 'rgba(236, 231, 220, 0.22)'
    ctx.fillRect(bar.x0, height - h, w, h)
  }
}

/** 竖向胶片脊柱（DESIGN §脊柱）：只画可见帧——剧照缩略 + 族色边 + 齿孔 + 密度柱 + 现在线。 */
import type { SpineFrame } from './lib/spine'

export interface SpinePaintOptions {
  /** 剧照缩略要的日期与当天镜次 */
  date: string
  ordinals: ReadonlyMap<string, number>
}

export function paintSpine(
  ctx: CanvasRenderingContext2D,
  frames: readonly SpineFrame[],
  range: { start: number; end: number },
  scrollTop: number,
  frameH: number,
  spineWidth: number,
  width: number,
  height: number,
  now: { y: number; label: string } | null,
  options: SpinePaintOptions
): void {
  // 胶片 60（含左右 2px 族色边）+ 齿孔 2 + 密度柱 24 = 88；标签画在 88 之外
  const filmW = 60
  const sprocketX = filmW
  const sprocketW = 2
  const densityX = filmW + sprocketW + 2
  const subW = 2
  const subGap = 2
  const densityEnd = Math.min(spineWidth, densityX + 6 * (subW + subGap))

  ctx.clearRect(0, 0, width, height)
  // 只给脊柱本身铺墨色；画布多出来的 96px 留给「现在」标签，保持透明
  ctx.fillStyle = '#0a0b0d'
  ctx.fillRect(0, 0, spineWidth, height)

  for (let index = range.start; index < range.end; index += 1) {
    const frame = frames[index]
    if (!frame) continue
    const y = Math.round(index * frameH - scrollTop)
    if (y > height || y + frameH < 0) continue
    const filled = frame.scene !== null && frame.hue !== null

    if (filled && frame.scene !== null && frame.hue !== null) {
      // 左右各 2px 族色边 + 中间的剧照缩略（紧凑帧档）
      ctx.fillStyle = familyColor(frame.hue, 0.9)
      ctx.fillRect(0, y + 1, 2, frameH - 2)
      ctx.fillRect(filmW - 2, y + 1, 2, frameH - 2)
      drawStill(
        ctx,
        frame.scene,
        options.ordinals.get(frame.scene.id) ?? 0,
        options.date,
        2,
        y + 1,
        filmW - 4,
        frameH - 2
      )
    } else {
      // 空档：45° 细斜纹，与放映空档态同一套语言
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, y + 1, filmW, frameH - 2)
      ctx.clip()
      ctx.strokeStyle = 'rgba(141, 147, 158, 0.10)'
      ctx.lineWidth = 1
      for (let offset = -frameH; offset < filmW + frameH; offset += 6) {
        ctx.beginPath()
        ctx.moveTo(offset, y + frameH)
        ctx.lineTo(offset + frameH, y)
        ctx.stroke()
      }
      ctx.restore()
    }

    // 右侧齿孔带
    ctx.fillStyle = 'rgba(10, 11, 13, 0.85)'
    ctx.fillRect(sprocketX, y, sprocketW, frameH - 1)
    ctx.fillStyle = 'rgba(236, 231, 220, 0.16)'
    ctx.fillRect(sprocketX, y + Math.round(frameH / 2) - 2, sprocketW, 4)

    // 密度柱：每帧 6 根 2px 小柱（100 秒一格）
    frame.levels.forEach((level, sub) => {
      if (level <= 0) return
      const x = densityX + sub * (subW + subGap)
      const barH = Math.max(2, Math.round(level * (frameH - 6)))
      ctx.fillStyle = 'rgba(236, 231, 220, 0.35)'
      ctx.fillRect(x, y + frameH - 2 - barH, subW, barH)
    })

    ctx.fillStyle = 'rgba(236, 231, 220, 0.05)'
    ctx.fillRect(0, y + frameH - 1, spineWidth, 1)
  }

  // 现在：2px 琥珀横线（只跨脊柱）+ 右侧（密度柱之外 +6px）的标签
  if (now !== null) {
    const y = Math.round(now.y)
    if (y >= -1 && y <= height + 1) {
      ctx.fillStyle = 'rgba(232, 180, 90, 0.95)'
      ctx.fillRect(0, y, spineWidth, 2)
      ctx.font = "400 10px 'Plex Mono', ui-monospace, monospace"
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      const textW = ctx.measureText(now.label).width
      const labelX = densityEnd + 6
      // 40% 墨色底，避免与帧内应用名叠字
      ctx.fillStyle = 'rgba(10, 11, 13, 0.4)'
      ctx.fillRect(labelX - 3, y - 14, Math.min(textW + 6, width - labelX + 3), 13)
      ctx.fillStyle = 'rgba(232, 180, 90, 0.95)'
      ctx.fillText(now.label, labelX, y - 8)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
    }
  }
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
      ctx.fillStyle = 'rgba(236, 231, 220, 0.08)'
      ctx.fillRect(x, height - 2, w, 2)
      return
    }
    ctx.fillStyle = `rgba(236, 231, 220, ${0.12 + level * 0.45})`
    ctx.fillRect(x, 2, w, height - 4)
  })
}

/** 对比视图的胶片带：两卷共享一条时间轴，按绝对时间投影到 range。 */
export function paintCompareStrip(
  ctx: CanvasRenderingContext2D,
  blocks: readonly { start: number; end: number; hue: number }[],
  range: { start: number; end: number } | null,
  width: number,
  height: number
): void {
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#101216'
  ctx.fillRect(0, 0, width, height)
  if (range === null || blocks.length === 0) {
    // 无采样：点阵，与日视图的“空胶片”同一套语言
    ctx.fillStyle = 'rgba(236, 231, 220, 0.07)'
    for (let x = 6; x < width - 4; x += 12) {
      for (let y = 6; y < height - 5; y += 9) ctx.fillRect(x, y, 1, 1)
    }
    return
  }
  const span = Math.max(1, range.end - range.start)
  for (const block of blocks) {
    const x = ((block.start - range.start) / span) * width
    const w = Math.max(1.5, ((block.end - block.start) / span) * width)
    ctx.fillStyle = familyColor(block.hue, 0.85)
    ctx.fillRect(x, 0, w, height)
  }
}

const POSTER_TONES: Record<string, keyof PosterPalette> = {
  display: 'paper',
  title: 'paper',
  label: 'muted',
  body: 'body',
  muted: 'muted',
  accent: 'accent'
}

/** #rrggbb → rgba()；已经是不透明 rgb/rgba 时原样返回。 */
function withAlpha(color: string, alpha: number): string {
  if (!color.startsWith('#') || color.length !== 7) return color
  const r = Number.parseInt(color.slice(1, 3), 16)
  const g = Number.parseInt(color.slice(3, 5), 16)
  const b = Number.parseInt(color.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function posterFont(family: 'display' | 'ui' | 'mono', size: number, weight: number): string {
  if (family === 'display') return `${weight} ${size}px 'Bebas', sans-serif`
  if (family === 'mono') return `${weight} ${size}px 'Plex Mono', ui-monospace, monospace`
  return `${weight} ${size}px 'Inter', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif`
}

/** 1600×1000 的一日电影海报：配色、胶片带、接触印相都由主题决定（R50）。 */
export function paintPoster(ctx: CanvasRenderingContext2D, layout: PosterLayout): void {
  const { width, height, palette } = layout
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = palette.background
  ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = 'alphabetic'

  // 背景题材水印：右对齐、裁在右栏，左缘渐显，不压左栏文字
  const backdrop = layout.backdrop
  if (backdrop !== null) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(backdrop.clip.x, backdrop.clip.y, backdrop.clip.w, backdrop.clip.h)
    ctx.clip()
    const fade = ctx.createLinearGradient(backdrop.clip.x, 0, backdrop.clip.x + backdrop.fade, 0)
    fade.addColorStop(0, withAlpha(palette.paper, 0))
    fade.addColorStop(1, withAlpha(palette.paper, backdrop.opacity))
    ctx.fillStyle = fade
    ctx.font = posterFont('display', backdrop.size, 400)
    ctx.textAlign = 'right'
    ctx.fillText(backdrop.text, backdrop.x, backdrop.y)
    ctx.restore()
  }

  // 胶片带：族色块 + 上下齿孔；极简主题没有
  const film = layout.film
  if (film !== null) {
    ctx.fillStyle = palette.panel
    ctx.fillRect(film.x, film.y, film.w, film.h)
    ctx.save()
    ctx.beginPath()
    ctx.rect(film.x, film.y, film.w, film.h)
    ctx.clip()
    for (const block of layout.blocks) {
      ctx.fillStyle = familyColor(block.hue, 0.85)
      ctx.fillRect(block.x, block.y, block.w, block.h)
    }
    const holes = layout.holes
    if (holes !== null) {
      ctx.fillStyle = palette.background
      for (let x = film.x + 10; x <= film.x + film.w - holes.w; x += holes.gap) {
        ctx.fillRect(x, holes.top, holes.w, holes.h)
        ctx.fillRect(x, holes.bottom, holes.w, holes.h)
      }
    }
    ctx.restore()
    ctx.strokeStyle = palette.hairline
    ctx.lineWidth = 1
    ctx.strokeRect(film.x + 0.5, film.y + 0.5, film.w - 1, film.h - 1)

    // 刻度尺：首尾对齐不出栏，中间居中
    ctx.strokeStyle = palette.hairline
    for (const tick of layout.ruler.ticks) {
      ctx.beginPath()
      ctx.moveTo(Math.round(tick.x) + 0.5, layout.ruler.y)
      ctx.lineTo(Math.round(tick.x) + 0.5, layout.ruler.y + 4)
      ctx.stroke()
    }
    ctx.font = posterFont('mono', 10, 400)
    ctx.fillStyle = palette.muted
    layout.ruler.ticks.forEach((tick, index, all) => {
      ctx.textAlign = index === 0 ? 'left' : index === all.length - 1 ? 'right' : 'center'
      ctx.fillText(tick.label, tick.x, layout.ruler.y + 20)
    })
    ctx.textAlign = 'left'
  }

  // 接触印相：与放映画面同一套版式（大镜次 + 应用名 + 时长尺）
  for (const print of layout.prints) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(print.x, print.y, print.w, print.h)
    ctx.clip()
    ctx.translate(print.x, print.y)
    paintProjectionBoard(
      ctx,
      projectionFrameParams({
        date: layout.date,
        shot: print.index,
        total: layout.printTotal,
        exe: print.exe.length > 0 ? print.exe : '中场休息',
        title: print.title,
        hue: print.hue,
        showBar: print.exe.length > 0,
        start: print.start,
        end: print.end,
        seconds: print.seconds,
        maxSeconds: print.maxSeconds,
        grainSeed: print.grainSeed,
        width: print.w,
        height: print.h
      })
    )
    ctx.restore()
    ctx.strokeStyle = palette.hairline
    ctx.strokeRect(print.x + 0.5, print.y + 0.5, print.w - 1, print.h - 1)
    ctx.font = posterFont('mono', 11, 400)
    ctx.fillStyle = palette.dim
    ctx.fillText(print.caption, print.x, print.captionY)
  }

  // 左栏文字
  for (const text of layout.texts) {
    ctx.fillStyle = palette[POSTER_TONES[text.tone] ?? 'body']
    if (text.letterSpacing !== undefined) ctx.letterSpacing = `${text.letterSpacing}px`
    ctx.font = posterFont(text.family, text.size, text.weight)
    ctx.textAlign = text.align ?? 'left'
    ctx.fillText(text.text, text.x, text.y, text.maxWidth)
    if (text.letterSpacing !== undefined) ctx.letterSpacing = '0px'
  }
  ctx.textAlign = 'left'

  // 手记：2px 暖色竖线 + 最多三行
  const note = layout.note
  if (note) {
    ctx.fillStyle = palette.accent
    ctx.fillRect(note.rule.x, note.rule.y0, note.rule.w, note.rule.y1 - note.rule.y0)
    ctx.font = posterFont('ui', note.size, 400)
    ctx.fillStyle = palette.body
    note.lines.forEach((line, index) => {
      ctx.fillText(line, note.x, note.y + index * note.lineHeight)
    })
  }

  // 无手记时的当日之最
  const extremes = layout.extremes
  if (extremes) {
    ctx.font = posterFont('mono', extremes.size, 400)
    ctx.fillStyle = palette.muted
    extremes.lines.forEach((line, index) => {
      ctx.fillText(line, extremes.x, extremes.y + index * extremes.lineHeight)
    })
  }

  // 页脚发丝线 + 一行说明
  ctx.strokeStyle = palette.hairline
  ctx.beginPath()
  ctx.moveTo(layout.footer.line.x0, layout.footer.line.y + 0.5)
  ctx.lineTo(layout.footer.line.x1, layout.footer.line.y + 0.5)
  ctx.stroke()
  ctx.font = posterFont('mono', 10, 400)
  ctx.fillStyle = palette.muted
  ctx.fillText(layout.footer.text, layout.footer.line.x0, layout.footer.line.y + 28)
}
