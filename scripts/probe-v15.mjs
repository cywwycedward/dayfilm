// 监督用：v1.5 验收（海报主题菜单、双日对比、片场日历、PDF 入口）。
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync, mkdirSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(process.env.TEMP ?? root, 'dfv15')
mkdirSync(outDir, { recursive: true })
const PORT = 9349
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const child = spawn(electron, ['.', `--remote-debugging-port=${PORT}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let page
for (let i = 0; i < 120 && !page; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
  } catch {}
  if (!page) await sleep(200)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true })
  ws.addEventListener('error', rej, { once: true })
})
let seq = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  const w = pending.get(m.id)
  if (!w) return
  pending.delete(m.id)
  if (m.error) w.reject(new Error(JSON.stringify(m.error)))
  else w.resolve(m.result)
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    seq += 1
    pending.set(seq, { resolve, reject })
    ws.send(JSON.stringify({ id: seq, method, params }))
  })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result.value
}
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  const path = join(outDir, `${name}.png`)
  writeFileSync(path, Buffer.from(r.data, 'base64'))
  return path
}

await sleep(5500)
const report = {}

report.buttons = await evaluate(`[...document.querySelectorAll('button')].map(b => b.textContent.replace(/\\s+/g,' ').trim()).filter(Boolean).slice(0, 20)`)

report.compare = await evaluate(`(async () => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('对比'))
  if (!btn) return { error: 'no compare button' }
  btn.click()
  await new Promise(r => setTimeout(r, 1600))
  const box = document.querySelector('#compare')
  return {
    visible: box ? !box.hidden : false,
    selects: box ? [...box.querySelectorAll('select')].map(s => s.value) : [],
    diff: box ? box.innerText.replace(/\\s+/g, ' ').match(/活跃[^。]{0,40}/)?.[0] ?? null : null,
    text: box ? box.innerText.replace(/\\s+/g, ' ').slice(0, 160) : null
  }
})()`)
report.compareShot = await shot('1-compare')
await evaluate(`(async () => { document.querySelector('#compare')?.querySelector('[data-close], .banner__close, button')?.click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(r => setTimeout(r, 500)) })()`)

report.calendar = await evaluate(`(async () => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '日历')
  if (!btn) return { error: 'no calendar button' }
  btn.click()
  await new Promise(r => setTimeout(r, 2500))
  const box = document.querySelector('#calendar')
  const cells = box ? box.querySelectorAll('[data-date]').length : 0
  return { visible: box ? !box.hidden : false, cells, text: box ? box.innerText.replace(/\\s+/g, ' ').slice(0, 120) : null }
})()`)
report.calendarShot = await shot('2-calendar')
await evaluate(`(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(r => setTimeout(r, 500)) })()`)

report.posterMenu = await evaluate(`(async () => {
  const btn = document.querySelector('#exportPoster')
  btn.click()
  await new Promise(r => setTimeout(r, 600))
  const items = [...document.querySelectorAll('[role="menuitem"], .poster-menu button, #posterMenu button')].map(el => el.textContent.trim())
  return { items, hasThemes: ['经典', '黑色电影', '极简'].every(t => items.some(i => i.includes(t))) }
})()`)
report.posterShot = await shot('3-poster-menu')

report.pdfButton = await evaluate(`!![...document.querySelectorAll('button')].find(b => b.textContent.includes('PDF'))`)

console.log(JSON.stringify(report, null, 2))
ws.close()
child.kill()
await sleep(1000)
process.exit(0)
