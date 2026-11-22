// 生成 build/icon.png（512×512）与 build/icon.ico（多尺寸，PNG 压缩条目）。
// 用法: npx electron scripts/pack/make-icon.cjs
// 深色圆角底 + 暖白胶片带：上下两排齿孔、三条分帧，缩小到 16px 仍是一条亮带。
const { app, BrowserWindow } = require('electron')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const OUT = join(__dirname, '..', '..', 'build')
const ICO_SIZES = [256, 128, 64, 48, 32, 16]
const PNG_SIZE = 512

const page = (size) => `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;padding:0;overflow:hidden;background:transparent}
canvas{display:block}
</style><canvas id=c width=${size} height=${size}></canvas><script>
const ctx = document.getElementById('c').getContext('2d')
ctx.scale(${size} / 512, ${size} / 512)
const round = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r) }
const WARM = '#f5ecd8', INK = '#0b0e13'
const g = ctx.createLinearGradient(0, 0, 0, 512)
g.addColorStop(0, '#1a2029'); g.addColorStop(1, '#0a0d12')
ctx.fillStyle = g; round(0, 0, 512, 512, 112); ctx.fill()
ctx.fillStyle = WARM; round(40, 128, 432, 256, 16); ctx.fill()
ctx.fillStyle = INK
for (const y of [144, 338]) for (let i = 0; i < 5; i++) {
  round(76 + i * 82.5, y, 30, 30, 6); ctx.fill()
}
for (const x of [184, 328]) { round(x - 4, 196, 8, 120, 4); ctx.fill() }
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

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: PNG_SIZE,
    height: PNG_SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false }
  })

  const grab = async (size) => {
    win.setContentSize(size, size)
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page(size)))
    await new Promise((r) => setTimeout(r, 150))
    const image = await win.webContents.capturePage()
    const got = image.getSize()
    const png = got.width === size && got.height === size ? image.toPNG() : image.resize({ width: size, height: size, quality: 'best' }).toPNG()
    return { size, png }
  }

  mkdirSync(OUT, { recursive: true })
  const big = await grab(PNG_SIZE)
  writeFileSync(join(OUT, 'icon.png'), big.png)

  const entries = []
  for (const size of ICO_SIZES) entries.push(await grab(size))
  writeFileSync(join(OUT, 'icon.ico'), buildIco(entries))

  // 自检：尺寸与四角透明（透明失败时角像素 alpha 为 255）。
  const check = require('electron').nativeImage.createFromPath(join(OUT, 'icon.png'))
  const alpha = check.getBitmap()[3]
  console.log(JSON.stringify({
    png: { path: join(OUT, 'icon.png'), size: check.getSize(), cornerAlpha: alpha },
    ico: { path: join(OUT, 'icon.ico'), entries: ICO_SIZES }
  }, null, 2))
  app.exit(alpha === 0 ? 0 : 2)
}).catch((err) => {
  console.error(err)
  app.exit(1)
})
