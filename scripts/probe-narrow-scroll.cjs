// 监督用：看 960×640 下主区到底能不能滚到右栏（不猜，直接量）。
// 用法：npx electron scripts/probe-narrow-scroll.cjs
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')

const root = join(__dirname, '..')

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    show: false,
    backgroundColor: '#08090c',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false }
  })
  await win.loadFile(join(root, 'out', 'renderer', 'index.html'))
  await new Promise((r) => setTimeout(r, 2800))
  const dbg = win.webContents.debugger
  dbg.attach('1.3')
  const run = async (expr) => {
    const r = await dbg.sendCommand('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  const report = await run(`(async () => {
    const main = document.querySelector('.main')
    const rail = document.querySelector('.rail')
    const recent = document.querySelector('.recent')
    const cs = getComputedStyle(main)
    const before = rail.getBoundingClientRect().top
    main.scrollTop = 99999
    await new Promise((r) => setTimeout(r, 120))
    const after = rail.getBoundingClientRect().top
    return {
      vw: innerWidth,
      vh: innerHeight,
      docScroll: document.documentElement.scrollHeight,
      mainOverflowY: cs.overflowY,
      mainClientH: main.clientHeight,
      mainScrollH: main.scrollHeight,
      canScroll: main.scrollHeight > main.clientHeight,
      railTopBefore: Math.round(before),
      railTopAfterScroll: Math.round(after),
      railReachableByScroll: after < innerHeight,
      recentClientH: recent.clientHeight,
      recentScrollH: recent.scrollHeight,
      spineCanvasW: document.querySelector('.spineCanvas, .spine__canvas').width
    }
  })()`)
  console.log(JSON.stringify(report, null, 1))
  app.exit(0)
})
