// 鐩戠潱鐢細鎶婅鏀圭殑缁勪欢鍏冪礌鐨?*璁＄畻鏍峰紡**瀵煎嚭鏉ワ紙CSS 鏈?6 灞傝鐩栵紝闈犺婧愮爜涓嶅彲闈狅級銆?// 鐢ㄦ硶锛歯px electron scripts/probe-styles.cjs
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')
const { writeFileSync } = require('node:fs')

const root = join(__dirname, '..')

const SELECTORS = [
  '.topbar .btn', '.topbar__date', '#search', '.chip',
  '.hero__clapper', '.hero__head', '.hero__genre', '.hero__verdict', '.hero__episode',
  '.hero__intermission', '.discoveries', '.discovery__label',
  '.hero__window', '.hero__window-label', '.hero__window strong', '.hero__window-title',
  '.hero__metrics', '.hero__metric dt', '.hero__metric dd',
  '.hero', '.hero__frame', '.hero__note', '.hero__band', '.hero__metrics', '.discoveries',
  '.spine', '.spine__edge', '.spine__viewport', '.spine__canvas',
  '.rail', '.rail__block', '.rail__head', '.rail__head h2', '.rail__head span',
  '.player__play', '.speeds', '.speed', '.speed[aria-pressed="true"]', '.player__clock', '.player__clock-dim', '.scrub',
  '.stats', '.metric__label', '.metric__value', '.stats__marks', '.stats__marks-label', '.stats__feature',
  '.stats__line', '.stats__line b',
  '.recent__cols', '.recent', '.recent .shot', '.shot__clock', '.shot__title', '.shot__project', '.shot__exe', '.shot__dur'
]

const PROBE = `(sels) => sels.map((sel) => {
  const el = document.querySelector(sel)
  if (!el) return { sel, missing: true }
  const cs = getComputedStyle(el)
  const r = el.getBoundingClientRect()
  return {
    sel,
    box: [Math.round(r.width), Math.round(r.height)].join('x'),
    font: cs.fontSize + '/' + cs.lineHeight + ' ' + cs.fontWeight + ' ' + cs.fontFamily.split(',')[0],
    color: cs.color,
    opacity: cs.opacity,
    deco: cs.textDecorationLine,
    border: cs.borderTopWidth + '/' + cs.borderBottomWidth + ' ' + cs.borderBottomColor,
    bg: cs.backgroundColor,
    pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
    margin: [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].join(' '),
    gap: cs.gap,
    align: cs.textAlign,
    grid: cs.gridTemplateColumns
  }
})`

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
  const run = async (expr) => {
    const r = await dbg.sendCommand('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  const rows = await run(`(${PROBE})(${JSON.stringify(SELECTORS)})`)
  const lines = rows.map((row) => {
    if (row.missing) return row.sel + '  |  MISSING'
    return [row.sel, row.box, row.font, row.color, 'op=' + row.opacity, row.deco === 'none' ? '' : row.deco, 'bd=' + row.border, 'bg=' + row.bg, 'pad=' + row.pad, 'gap=' + row.gap].join('  |  ')
  })
  writeFileSync(join(process.env.TEMP || root, 'df-styles.txt'), lines.join('\n'), 'utf8')
  console.log(lines.join('\n'))
  app.exit(0)
})

