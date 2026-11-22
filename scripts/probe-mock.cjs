// 监督用：在 mock 数据下测量版式，并按真实窗口尺寸截图。
// 用法: npx electron scripts/probe-mock.cjs <输出png> [宽 高]
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')
const { writeFileSync } = require('node:fs')

const out = process.argv[2] || join(__dirname, '..', 'mock.png')
const width = Number(process.argv[3] || 1280)
const height = Number(process.argv[4] || 820)

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width,
    height,
    show: true,
    backgroundColor: '#06070a',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })
  await win.loadFile(join(__dirname, '..', 'out', 'renderer', 'index.html'))
  await new Promise((r) => setTimeout(r, 2500))
  const report = await win.webContents.executeJavaScript(`(() => {
    const rect = (el) => el ? { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null
    const sections = [...document.querySelectorAll('body > *, #app > *')].map((el) => ({
      tag: el.tagName.toLowerCase(),
      cls: el.className || null,
      ...rect(el)
    }))
    return {
      viewport: { w: innerWidth, h: innerHeight },
      doc: { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, scrollH: document.documentElement.scrollHeight, clientH: document.documentElement.clientHeight },
      sections,
      metrics: [...document.querySelectorAll('.metric, .summary dd, .summary dt')].slice(0, 12).map((el) => el.textContent.replace(/\\s+/g, ' ').trim())
    }
  })()`)
  const frames = await win.webContents.executeJavaScript(`(async () => {
    const play = document.querySelector('#play')
    if (play && play.textContent.includes('播放')) play.click()
    const speed = document.querySelector('[data-speed="600"]')
    if (speed) speed.click()
    const times = []
    await new Promise((resolve) => {
      let last = performance.now()
      let n = 0
      const tick = () => {
        const now = performance.now()
        times.push(now - last)
        last = now
        n += 1
        if (n < 150) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    const sorted = times.slice(5).sort((a, b) => a - b)
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
    return { medianMs: at(0.5), p95Ms: at(0.95), fpsMedian: Math.round(1000 / at(0.5)), fpsP5: Math.round(1000 / at(0.95)) }
  })()`)
  const image = await win.webContents.capturePage()
  writeFileSync(out, image.toPNG())
  console.log(JSON.stringify({ ...report, frames }, null, 2))
  app.exit(0)
})
