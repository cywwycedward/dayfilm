/**
 * 剧照绘制：按 lib/still-frame.ts 的参数把一帧画进 canvas。
 * 参数随目标尺寸计算（文档里的"帧高 < 90px 用 18px"就是这样生效的），
 * 同一场景在胶片、缩略图、放大帧、海报里用同一套版式规则。
 */
import type { SceneKind } from '../../shared/types'
import { familyColor, grainPoints, stillParams, type StillLine, type StillParams } from './lib/still-frame'
import type { ProjectionFrameParams } from './lib/projection-frame'

export interface StillScene {
  exe: string
  title: string
  kind: SceneKind
}

const urls = new Map<string, string>()
const listeners: (() => void)[] = []
let fontsReady = false

function markReady(): void {
  fontsReady = true
  urls.clear()
  for (const cb of listeners.splice(0)) cb()
}

if (typeof document !== 'undefined' && document.fonts) {
  if (document.fonts.status === 'loaded') markReady()
  else void document.fonts.ready.then(markReady)
} else {
  fontsReady = true
}

export function stillFontsReady(): boolean {
  return fontsReady
}

/** 字体就绪后回调一次（未就绪时排队），用来重绘首屏的无字版本。 */
export function onStillFontsReady(cb: () => void): void {
  if (fontsReady) cb()
  else listeners.push(cb)
}

function fontOf(line: StillLine): string {
  return familyFont(line.family, line.size, line.weight)
}

function familyFont(family: StillLine['family'], size: number, weight = 400): string {
  if (family === 'display') return `${weight} ${size}px 'Bebas', sans-serif`
  if (family === 'mono') return `${weight} ${size}px 'Plex Mono', ui-monospace, monospace`
  return `${weight} ${size}px 'Inter', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif`
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number | null): string {
  if (maxWidth === null || ctx.measureText(text).width <= maxWidth) return text
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1)
  return `${cut}…`
}

function paintSliver(ctx: CanvasRenderingContext2D, params: StillParams): void {
  const { width: w, height: h } = params
  ctx.fillStyle = params.intermission ? 'rgba(141, 147, 158, 0.18)' : familyColor(params.hue, 0.35)
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(236, 231, 220, 0.55)'
  ctx.fillRect(0, 0, w, params.sliver?.highlightH ?? 2)
}

/** 把参数画成图。实现只做 ctx 调用，布局全在 stillParams 里。 */
export function paintStillFrame(
  ctx: CanvasRenderingContext2D,
  params: StillParams,
  withText = fontsReady
): void {
  const { width: w, height: h } = params
  if (!(w > 0) || !(h > 0)) return

  if (params.tier === 'sliver') {
    paintSliver(ctx, params)
    return
  }

  ctx.fillStyle = '#12141a'
  ctx.fillRect(0, 0, w, h)

  if (params.hatch) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, w, h)
    ctx.clip()
    ctx.strokeStyle = `rgba(141, 147, 158, ${params.hatch.alpha})`
    ctx.lineWidth = 1
    for (let offset = -h; offset < w + h; offset += params.hatch.spacing) {
      ctx.beginPath()
      ctx.moveTo(offset, h)
      ctx.lineTo(offset + h, 0)
      ctx.stroke()
    }
    ctx.restore()
  }

  const shade = ctx.createLinearGradient(0, 0, 0, h)
  shade.addColorStop(0, 'rgba(10, 11, 13, 0.06)')
  shade.addColorStop(1, 'rgba(10, 11, 13, 0)')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, w, h)

  if (params.sideBar?.visible) {
    ctx.fillStyle = familyColor(params.hue)
    ctx.fillRect(0, 0, params.sideBar.w, h)
  }
  if (params.topBar?.visible) {
    ctx.fillStyle = familyColor(params.hue)
    ctx.fillRect(0, 0, w, params.topBar.h)
  }

  if (params.holes.length > 0) {
    ctx.fillStyle = 'rgba(10, 11, 13, 0.85)'
    for (const hole of params.holes) {
      ctx.beginPath()
      ctx.roundRect(hole.x, hole.y, hole.w, hole.h, 1)
      ctx.fill()
    }
  }

  if (params.grain) {
    for (const point of grainPoints(params.grain.seed, params.grain.count, w, h)) {
      ctx.fillStyle = `rgba(236, 231, 220, ${point.a})`
      ctx.fillRect(point.x, point.y, 1, 1)
    }
  }

  if (params.border) {
    // 剧照卡片：不画外框，只留 1px 内发丝线（visual-language §8.8）
    ctx.strokeStyle = 'rgba(236, 231, 220, 0.06)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1)
  }

  if (!withText) return
  ctx.textBaseline = 'alphabetic'
  for (const line of params.lines) {
    if (line.text.length === 0) continue
    ctx.font = fontOf(line)
    ctx.globalAlpha = line.opacity
    ctx.fillStyle = '#ece7dc'
    ctx.textAlign = line.align
    const text = fitText(ctx, line.text, line.maxWidth)
    ctx.fillText(text, line.align === 'right' ? line.x : Math.round(line.x), Math.round(line.y))
  }
  ctx.globalAlpha = 1
  ctx.textAlign = 'left'
}

/** 在任意矩形里画一张剧照：参数按这个矩形的大小算，不做位图缩放排版。 */
export function drawStill(
  ctx: CanvasRenderingContext2D,
  scene: StillScene,
  index: number,
  date: string,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  if (!(width > 0) || !(height > 0)) return
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, width, height)
  ctx.clip()
  ctx.translate(x, y)
  paintStillFrame(
    ctx,
    stillParams({
      ...scene,
      index,
      date,
      width: Math.round(width),
      height: Math.round(height)
    })
  )
  ctx.restore()
}

/** 放映大画面：背景大镜次、8% 起排的文本块、底部长时长尺、确定性颇粒。 */
export function paintProjectionBoard(ctx: CanvasRenderingContext2D, params: ProjectionFrameParams): void {
  const { width: w, height: h } = params
  ctx.fillStyle = '#0e1014'
  ctx.fillRect(0, 0, w, h)

  ctx.fillStyle = familyColor(params.hue)
  ctx.fillRect(0, 0, params.sideBar, h)

  const vignette = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.35,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.75
  )
  vignette.addColorStop(0, 'rgba(10, 11, 13, 0)')
  vignette.addColorStop(1, `rgba(10, 11, 13, ${params.vignette})`)
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, w, h)

  // 背景大数字：右对齐、垂直居中，超出帧的部分裁掉
  const badge = params.bigNumber
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, w, h)
  ctx.clip()
  ctx.globalAlpha = badge.opacity
  ctx.fillStyle = '#ece7dc'
  ctx.font = familyFont('display', badge.size)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillText(badge.text, badge.x, badge.y)
  ctx.restore()

  // 底部时长尺：整幅宽 1px 基线 + 族色填充段
  const ruler = params.ruler
  ctx.fillStyle = 'rgba(236, 231, 220, 0.08)'
  ctx.fillRect(ruler.x0, ruler.y, ruler.x1 - ruler.x0, 1)
  if (ruler.fill > 0) {
    ctx.fillStyle = familyColor(params.hue)
    ctx.fillRect(ruler.x0, ruler.y - 1, ruler.fill, 2)
  }

  // 3% 确定性颇粒（与剧照同一套噪声）
  for (const point of grainPoints(params.grain.seed, params.grain.count, w, h)) {
    ctx.globalAlpha = point.a * params.grain.opacity
    ctx.fillStyle = '#ece7dc'
    ctx.fillRect(point.x, point.y, 1, 1)
  }

  ctx.strokeStyle = 'rgba(236, 231, 220, 0.14)'
  ctx.lineWidth = 1
  for (const line of [params.top, params.bottom]) {
    ctx.beginPath()
    ctx.moveTo(line.x0, Math.round(line.y) + 0.5)
    ctx.lineTo(line.x1, Math.round(line.y) + 0.5)
    ctx.stroke()
  }

  ctx.textBaseline = 'alphabetic'
  for (const line of params.lines) {
    ctx.font = familyFont(line.family, line.size)
    ctx.globalAlpha = line.opacity
    ctx.fillStyle = '#ece7dc'
    ctx.textAlign = line.align
    const text = fitText(ctx, line.text, line.maxWidth)
    ctx.fillText(text, line.align === 'right' ? line.x : Math.round(line.x), Math.round(line.y))
  }
  ctx.globalAlpha = 1
  ctx.textAlign = 'left'
}

/** 放映时遇到空隙：斜纹铺满 + 主文案「空档」+ 一行说明，比纯黑画面更接近日视图的克制处理。 */
export function paintProjectionGap(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  caption: string
): void {
  ctx.fillStyle = '#0a0b0d'
  ctx.fillRect(0, 0, width, height)

  // 45° 细斜纹（与中场休息的 hatch 同一套语言，不抢主画面）
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, width, height)
  ctx.clip()
  ctx.strokeStyle = 'rgba(141, 147, 158, 0.10)'
  ctx.lineWidth = 1
  const spacing = Math.max(6, Math.round(width / 120))
  for (let offset = -height; offset < width + height; offset += spacing) {
    ctx.beginPath()
    ctx.moveTo(offset, height)
    ctx.lineTo(offset + height, 0)
    ctx.stroke()
  }
  ctx.restore()

  ctx.strokeStyle = 'rgba(236, 231, 220, 0.07)'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1)

  const main = Math.max(28, Math.round(width / 34))
  const subtitle = Math.max(12, Math.round(width / 78))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `400 ${main}px 'Plex Mono', ui-monospace, monospace`
  ctx.fillStyle = 'rgba(236, 231, 220, 0.55)'
  ctx.fillText('空档', Math.round(width / 2), Math.round(height / 2 - subtitle * 0.9))
  ctx.font = `400 ${subtitle}px 'Plex Mono', ui-monospace, monospace`
  ctx.fillStyle = 'rgba(236, 231, 220, 0.32)'
  ctx.fillText(caption, Math.round(width / 2), Math.round(height / 2 + subtitle * 1.6))
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}
export function stillDataUrl(
  scene: StillScene,
  index: number,
  date: string,
  width: number,
  height: number
): string {
  const key = `${scene.kind}|${scene.exe}|${scene.title}|${index}|${date}|${width}x${height}`
  const cached = urls.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx) paintStillFrame(ctx, stillParams({ ...scene, index, date, width, height }))
  const url = canvas.toDataURL('image/png')
  if (urls.size > 400) urls.clear()
  urls.set(key, url)
  return url
}
