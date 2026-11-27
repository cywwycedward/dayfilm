// 监督用：把构建好的界面（无主进程，走 mock 数据）渲染出来，截 4 个状态并导出各元素的几何/字号，
// 用来看视觉层级与裁切。用法：npx electron scripts/probe-hierarchy.cjs
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')
const { writeFileSync, mkdirSync } = require('node:fs')

const root = join(__dirname, '..')
const outDir = join(process.env.TEMP || root, 'dfhier')
mkdirSync(outDir, { recursive: true })

app.disableHardwareAcceleration()

const PROBE = `(() => {
  const sel = '.topbar,h1.brand,.topbar__date,#chip,.topbar__search,#search,.topbar__end .btn,.main,.hero,.hero__clapper,.hero__head,.hero__chip,.mode,.hero__genre,.hero__verdict,.hero__episode,.hero__intermission,.discoveries,.hero__window,.hero__metrics,.hero__metric dd,.hero__frame,.rail,.rail__card,.projection,.stats,.recent,.spine'
  const out = []
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    const cs = getComputedStyle(el)
    out.push({
      tag: el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ').filter(Boolean).slice(0, 2).join('.'),
      box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(','),
      font: cs.fontSize + '/' + cs.lineHeight,
      weight: cs.fontWeight,
      color: cs.color,
      clip: r.bottom > innerHeight - 1 ? 'over-bottom:' + Math.round(r.bottom - innerHeight) : '',
      text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 24)
    })
  }
  return { vw: innerWidth, vh: innerHeight, scrollH: document.documentElement.scrollHeight, rows: out }
})()`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    backgroundColor: '#08090c',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false }
  })
  await win.loadFile(join(root, 'out', 'renderer', 'index.html'))
  const dbg = win.webContents.debugger
  dbg.attach('1.3')
  await dbg.sendCommand('Page.enable')
  const load = async (time) => {
    const { identifier } = await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: `{
        const SystemDate = Date
        const time = SystemDate.parse(${JSON.stringify(time)})
        globalThis.Date = class extends SystemDate {
          constructor(...args) { super(...(args.length ? args : [time])) }
          static now() { return time }
        }
      }`
    })
    await dbg.sendCommand('Page.reload')
    await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 800))')
    await dbg.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier })
  }
  const shot = async (name) => {
    const r = await dbg.sendCommand('Page.captureScreenshot', { format: 'png' })
    const path = join(outDir, name + '.png')
    writeFileSync(path, Buffer.from(r.data, 'base64'))
    return path
  }
  const js = async (code) => {
    const r = await dbg.sendCommand('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))

  const report = { shots: {} }
  await load('2026-11-27T21:17:50+08:00')
  await wait(1500)
  await js("document.querySelector('.recent .shot')?.click()")
  report.day = await js(PROBE)
  report.shots.day = await shot('1-day-1280')

  await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width: 960, height: 640, deviceScaleFactor: 1, mobile: false })
  await wait(1200)
  report.narrow = await js(PROBE)
  report.shots.narrow = await shot('2-day-960')
  report.narrowScroll = await js(`(() => {
    const main = document.querySelector('.main')
    main.scrollTop = main.scrollHeight
    const result = {
      scrollTop: main.scrollTop,
      railVisible: document.querySelector('.rail').getBoundingClientRect().top < innerHeight,
      evidenceReachable: document.querySelector('#discoveries').getBoundingClientRect().bottom <= innerHeight
    }
    main.scrollTop = 0
    return result
  })()`)
  await dbg.sendCommand('Emulation.clearDeviceMetricsOverride')
  await wait(800)

  await js("(async () => { document.querySelector('#settings')?.click(); await new Promise(r => setTimeout(r, 900)) })()")
  report.shots.settings = await shot('3-settings')
  await js("(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(r => setTimeout(r, 400)) })()")

  await js("(async () => { document.querySelector('#modeWeek')?.click(); await new Promise(r => setTimeout(r, 1800)) })()")
  report.shots.week = await shot('4-week')
  report.weekBadgesFit = await js(`[...document.querySelectorAll('.arc .tag')].every((tag) =>
    tag.getBoundingClientRect().right <= tag.closest('.arc').getBoundingClientRect().right)`)

  await load('2026-11-27T21:17:50+08:00')
  await wait(1000)
  await js("document.querySelector('.player__play').click()")
  await wait(220)
  report.shots.playback = await shot('5-playback')

  await win.loadFile(join(root, 'out', 'renderer', 'index.html'), { query: { mock: 'fresh' } })
  await wait(1000)
  report.emptyState = await js("document.querySelector('#genre').dataset.empty")
  report.shots.empty = await shot('6-empty')

  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 1))
  console.log(JSON.stringify(report, null, 1))
  app.exit(0)
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
