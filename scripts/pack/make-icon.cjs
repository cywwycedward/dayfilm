// 品牌资产：build/icon.png（512）+ build/icon.ico（六尺寸）+ build/icon-16-preview.png
// 与 resources/tray.png / tray-paused.png / tray-error.png（32×32 三态）。
// 用法: npx electron scripts/pack/make-icon.cjs
// 造型：深色圆角底 + 一帧胶片（暖白边框）+ 中央一条暖白曝光缝；16px 去掉边框只留亮缝。
// 尺寸都是原生绘制（canvas 按目标像素尺寸画，不靠缩放大图）；三态托盘与主图标共用同一套几何。
const { app, BrowserWindow, nativeImage } = require('electron')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..', '..')
const BUILD = join(ROOT, 'build')
const RES = join(ROOT, 'resources')

const ICO_SIZES = [256, 128, 64, 48, 32, 16]
const PAPER = '#ece7dc'
const TRAY_STATES = [
  { file: 'tray.png', color: '#ece7dc' },
  { file: 'tray-paused.png', color: '#8d939e' },
  { file: 'tray-error.png', color: '#b8524a' }
]

// 设计稿在 512×512 单位空间里画，再按目标像素缩放；所有尺寸共用这组常量。
// 造型 = 深色圆角底 + 一帧胶片（暖白细边框 + 上下各 4 个齿孔）+ 中央暖白曝光缝。
const page = `<!doctype html><meta charset="utf-8"><script>
const BG_R = 112
const FRAME = { x: 64, y: 124, w: 384, h: 264, r: 22 }
const SLIT = { cy: 256, w: 268, h: 28 }
// 齿孔：尺寸 ≥ 48 才画（再小就贴上边框了），每个宽 44 高 22，距边框内侧 12。
const HOLE = { w: 44, h: 22, gap: 12, count: 4, from: 48 }

function canvasOf(size) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return c
}

function draw(job) {
  const { size, color } = job
  const u = size / 512
  const c = canvasOf(size)
  const ctx = c.getContext('2d')
  ctx.scale(u, u) // 之后全部坐标都在 512×512 的设计稿单位里

  if (job.bg) {
    const g = ctx.createLinearGradient(0, 0, 0, 512)
    g.addColorStop(0, '#0a0b0d')
    g.addColorStop(1, '#12141a')
    ctx.beginPath()
    ctx.roundRect(0, 0, 512, 512, BG_R)
    ctx.fillStyle = g
    ctx.fill()
  }

  ctx.fillStyle = color
  // 16px 下边框糊成一团，只留亮缝（brief 允许「深底 + 一条暖缝」）。
  const ring = size >= 24
  // 边框与亮缝在目标像素上的最小厚度（换算回设计稿单位），避免小尺寸细线被反锯齿吃掉。
  const band = Math.min(FRAME.w / 4, Math.max(16, job.minBand / u))
  const slit = Math.min(FRAME.h / 2, Math.max(SLIT.h, job.minSlit / u))

  if (ring) {
    ctx.beginPath()
    ctx.roundRect(FRAME.x, FRAME.y, FRAME.w, FRAME.h, FRAME.r)
    ctx.roundRect(
      FRAME.x + band,
      FRAME.y + band,
      FRAME.w - 2 * band,
      FRAME.h - 2 * band,
      Math.max(2, FRAME.r - band)
    )
    ctx.fill('evenodd')
  }

  if (ring && size >= HOLE.from) {
    const step = (FRAME.w - 2 * band) / HOLE.count
    for (let i = 0; i < HOLE.count; i++) {
      const cx = FRAME.x + band + step * (i + 0.5)
      ctx.beginPath()
      ctx.roundRect(cx - HOLE.w / 2, FRAME.y + band + HOLE.gap, HOLE.w, HOLE.h, 5)
      ctx.fill()
      ctx.beginPath()
      ctx.roundRect(cx - HOLE.w / 2, FRAME.y + FRAME.h - band - HOLE.gap - HOLE.h, HOLE.w, HOLE.h, 5)
      ctx.fill()
    }
  }

  ctx.beginPath()
  ctx.roundRect(256 - SLIT.w / 2, SLIT.cy - slit / 2, SLIT.w, slit, slit / 2)
  ctx.fill()

  if (!job.zoom) return c
  const big = canvasOf(size * job.zoom)
  const bctx = big.getContext('2d')
  bctx.imageSmoothingEnabled = false
  bctx.drawImage(c, 0, 0, big.width, big.height)
  return big
}

window.__draw = (jobs) => jobs.map((job) => draw(job).toDataURL('image/png'))
</script>`

/** ICO 容器：头 + 每条目 16 字节目录 + 直接拼 PNG。 */
function buildIco(entries) {
  const head = Buffer.alloc(6)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = 6 + dir.length
  entries.forEach(({ size, png }, i) => {
    const b = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, b)
    dir.writeUInt8(size >= 256 ? 0 : size, b + 1)
    dir.writeUInt16LE(1, b + 4)
    dir.writeUInt16LE(32, b + 6)
    dir.writeUInt32LE(png.length, b + 8)
    dir.writeUInt32LE(offset, b + 12)
    offset += png.length
  })
  return Buffer.concat([head, dir, ...entries.map((e) => e.png)])
}

/** 从 ICO 里取回每条目 PNG（自检用：解回 nativeImage 才能验尺寸与透明角）。 */
function icoEntries(ico) {
  const out = []
  for (let i = 0; i < ico.readUInt16LE(4); i++) {
    const b = 6 + i * 16
    const bytes = ico.readUInt32LE(b + 8)
    const offset = ico.readUInt32LE(b + 12)
    out.push({ size: ico.readUInt8(b) || 256, png: ico.subarray(offset, offset + bytes) })
  }
  return out
}

const toPng = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')

/** 断言：尺寸、四角 alpha=0、中心像素是 slit 颜色（说明图形真的画出来了）。 */
function inspect(png, expectSize, expectColor, label) {
  const image = nativeImage.createFromBuffer(png)
  const { width, height } = image.getSize()
  const bmp = image.getBitmap()
  // 16px 的圆角只有 3.5px，角像素会带一点反锯齿灰（≤16/255），超过就是圆角没生效。
  const corners = [
    (0 * width + 0) * 4 + 3,
    (0 * width + width - 1) * 4 + 3,
    ((height - 1) * width + 0) * 4 + 3,
    ((height - 1) * width + width - 1) * 4 + 3
  ].map((i) => bmp[i])
  const center = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4
  const rgb = [bmp[center + 2], bmp[center + 1], bmp[center]] // BGRA -> RGB
  const want = [1, 3, 5].map((i) => parseInt(expectColor.slice(i, i + 2), 16))
  const colorOk = rgb.every((v, i) => Math.abs(v - want[i]) <= 2) && bmp[center + 3] === 255
  const ok = width === expectSize && height === expectSize && corners.every((a) => a <= 16) && colorOk
  return { label, ok, size: [width, height], cornerAlpha: corners, centerRgb: rgb, expectColor, bytes: png.length }
}

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const jobs = [
    { name: 'icon.png', size: 512, bg: true, color: PAPER, minBand: 1.6, minSlit: 2.2 },
    ...ICO_SIZES.map((size) => ({
      name: `ico-${size}`,
      size,
      bg: true,
      color: PAPER,
      minBand: 1.6,
      minSlit: 2.2
    })),
    { name: 'icon-16-preview.png', size: 16, bg: true, color: PAPER, minBand: 1.6, minSlit: 2.2, zoom: 8 },
    // 托盘会被系统缩到 16–20px 显示，边框与亮缝按 32px 下的实际长度放大一档。
    ...TRAY_STATES.map(({ file, color }) => ({
      name: file,
      size: 32,
      bg: false,
      color,
      minBand: 2.4,
      minSlit: 2.8
    }))
  ]

  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false }
  })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page))
  const dataUrls = await win.webContents.executeJavaScript(`window.__draw(${JSON.stringify(jobs)})`, true)

  const rendered = {}
  jobs.forEach((job, i) => {
    rendered[job.name] = toPng(dataUrls[i])
  })

  mkdirSync(BUILD, { recursive: true })
  mkdirSync(RES, { recursive: true })
  writeFileSync(join(BUILD, 'icon.png'), rendered['icon.png'])
  writeFileSync(join(BUILD, 'icon-16-preview.png'), rendered['icon-16-preview.png'])
  for (const { file } of TRAY_STATES) writeFileSync(join(RES, file), rendered[file])

  const icoEntriesRaw = ICO_SIZES.map((size) => ({ size, png: rendered[`ico-${size}`] }))
  const ico = buildIco(icoEntriesRaw)
  writeFileSync(join(BUILD, 'icon.ico'), ico)

  // 自检：icon.png、ICO 六条目、16px 预览、三个托盘，逐个解回 nativeImage。
  const checks = [
    inspect(rendered['icon.png'], 512, PAPER, 'icon.png'),
    ...icoEntries(ico).map((e) =>
      inspect(e.png, e.size, PAPER, `icon.ico@${e.size}`)
    ),
    inspect(rendered['icon-16-preview.png'], 128, PAPER, 'icon-16-preview.png'),
    ...TRAY_STATES.map(({ file, color }) => inspect(rendered[file], 32, color, file))
  ]
  const ok = checks.every((c) => c.ok)
  console.log(
    JSON.stringify(
      {
        ok,
        outputs: [
          { path: join(BUILD, 'icon.png'), bytes: rendered['icon.png'].length },
          { path: join(BUILD, 'icon.ico'), bytes: ico.length, entries: ICO_SIZES },
          { path: join(BUILD, 'icon-16-preview.png'), bytes: rendered['icon-16-preview.png'].length },
          ...TRAY_STATES.map(({ file }) => ({ path: join(RES, file), bytes: rendered[file].length }))
        ],
        checks
      },
      null,
      2
    )
  )
  win.destroy()
  app.exit(ok ? 0 : 2)
}).catch((err) => {
  console.error(err)
  app.exit(1)
})
