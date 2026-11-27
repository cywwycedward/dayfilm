// 监督用：按组件裁剪真机截图（2x）并导出细节指标，用来看组件级的排版、对齐、边框与状态。
// 用法：npx electron scripts/probe-components.cjs
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')
const { writeFileSync, mkdirSync } = require('node:fs')

const root = join(__dirname, '..')
const outDir = join(process.env.TEMP || root, 'dfcomp')
mkdirSync(outDir, { recursive: true })

app.disableHardwareAcceleration()

// 每张图 = 若干选择器的并集，外加 8px 留白
const SHOTS = [
  ['01-topbar', ['.topbar'], 0],
  ['02-hero-identity', ['.hero__summary'], 0],
  ['03-hero-evidence', ['.review-context'], 0],
  ['04-control-strip', ['.hero__window', '.hero__metrics'], 0],
  ['05-still', ['.hero__frame'], 0],
  ['06-spine', ['.spine'], 0],
  ['07-projection', ['.review-stage .player'], 0],
  ['08-stats', ['.rail__block:not(.rail__block--grow)'], 0],
  ['09-recent', ['.rail__block--grow'], 0],
  ['10-drawer', ['#panel'], 'settings'],
  ['11-drawer-nav', ['#panel nav', '.panel__nav, .nav'], 'settings'],
  ['12-week-bar', ['.week-film__bar'], 'week'],
  ['13-week-cols', ['.week-film__scroll'], 'week']
]

const DETAIL = `(sels) => {
  const out = []
  for (const sel of sels) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      const cs = getComputedStyle(el)
      out.push({
        sel,
        box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        font: cs.fontSize + '/' + cs.lineHeight + ' ' + cs.fontWeight,
        color: cs.color,
        bg: cs.backgroundColor,
        border: cs.borderTopWidth + ' ' + cs.borderTopColor,
        pad: cs.padding,
        gap: cs.gap,
        align: cs.textAlign,
        deco: cs.textDecorationLine,
        ls: cs.letterSpacing,
        text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 30)
      })
    }
  }
  return out
}`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    backgroundColor: '#08090c',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false }
  })
  await win.loadFile(join(root, 'out', 'renderer', 'index.html'))
  await new Promise((r) => setTimeout(r, 2800))
  const dbg = win.webContents.debugger
  dbg.attach('1.3')
  const js = async (code, args) => {
    const r = await dbg.sendCommand('Runtime.evaluate', args === undefined
      ? { expression: code, awaitPromise: true, returnByValue: true }
      : { expression: code, awaitPromise: true, returnByValue: true, arguments: [{ value: args }] })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  const rectOf = async (sels) => js(`(() => {
    let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9
    for (const s of ${JSON.stringify(sels)}) for (const el of document.querySelectorAll(s)) {
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom)
    }
    if (x2 < x1) return null
    return { x: Math.max(0, x1 - 8), y: Math.max(0, y1 - 8), width: Math.min(innerWidth, x2 + 8) - Math.max(0, x1 - 8), height: Math.min(innerHeight, y2 + 8) - Math.max(0, y1 - 8) }
  })()`)

  const report = { shots: {}, detail: {} }
  const shoot = async (name, sels) => {
    const clip = await rectOf(sels)
    if (!clip) return report.shots[name] = 'missing'
    const r = await dbg.sendCommand('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } })
    const path = join(outDir, name + '.png')
    writeFileSync(path, Buffer.from(r.data, 'base64'))
    report.shots[name] = { path, clip }
  }
  const detail = async (key, quote) => {
    const r = await dbg.sendCommand('Runtime.evaluate', {
      expression: `(${DETAIL})(${quote})`,
      returnByValue: true,
      awaitPromise: true
    })
    report.detail[key] = r.result.value
  }

  for (const [name, sels] of SHOTS.slice(0, 9)) await shoot(name, sels)
  await detail('day', JSON.stringify(['.topbar .btn', '.chip', '.topbar__date', '#search', '.hero__verdict', '.hero__episode', '.hero__intermission', '.discoveries .discovery__label', '.hero__window-label', '.hero__metric dt', '.hero__metric dd', '.rail__head h2', '.rail__head span', '.player__clock', '.stats__line', '.stats .metric__value', '.recent__cols', '.recent .shot', '.spine__frame', '.spine__now']))

  await js("(async () => { document.querySelector('#settings')?.click(); await new Promise(r => setTimeout(r, 900)) })()")
  for (const [name, sels] of SHOTS.filter((s) => s[2] === 'settings')) await shoot(name, sels)
  await detail('settings', JSON.stringify(['.panel__title, #panelTitle', '.nav-item', '.nav-item.is-active', '.panel .row, .fieldset .row', '.panel .btn']))
  await js("(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(r => setTimeout(r, 400)) })()")

  await js("(async () => { document.querySelector('#modeWeek')?.click(); await new Promise(r => setTimeout(r, 1800)) })()")
  for (const [name, sels] of SHOTS.filter((s) => s[2] === 'week')) await shoot(name, sels)
  await detail('week', JSON.stringify(['.week-film__range', '.week-day__name, .week-film__day', '.week-day__meta, .week-film__meta', '.week-film__verdict', '.week-film__col']))

  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 1))
  console.log('ok ' + outDir)
  app.exit(0)
})
