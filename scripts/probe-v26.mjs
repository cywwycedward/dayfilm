// 监督用：v2.6 验收（音效设置、批量标记菜单、周电影正片口径）。
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync, mkdirSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(process.env.TEMP ?? root, 'dfv26')
mkdirSync(outDir, { recursive: true })
const PORT = 9357
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const child = spawn(electron, ['.', `--remote-debugging-port=${PORT}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let page
for (let i = 0; i < 120 && !page; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    page = list.find((t) => t.type === 'page' && t.url.endsWith('/index.html'))
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

await sleep(6000)
const report = {}

report.settings = await evaluate(`(async () => {
  document.querySelector('#settings')?.click()
  await new Promise(r => setTimeout(r, 900))
  const panel = document.querySelector('#panel')
  const text = panel ? panel.innerText.replace(/\\s+/g, ' ') : ''
  return {
    open: !!panel,
    hasSound: text.includes('放映音效'),
    modes: [...document.querySelectorAll('#panel button, #panel [role=radio]')].map(b => b.textContent.trim()).filter(t => t && t.length < 8).slice(0, 12),
    hasVolume: !!document.querySelector('#panel input[type=range]'),
    hasAutoExtra: text.includes('自动') || text.includes('花絮')
  }
})()`)
report.settingsShot = await shot('1-settings')
await evaluate(`(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(r => setTimeout(r, 500)) })()`)

report.menu = await evaluate(`(async () => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '···')
  btn?.click()
  await new Promise(r => setTimeout(r, 500))
  const items = [...document.querySelectorAll('#moreMenu button, [role=menuitem]')].map(b => b.textContent.replace(/\\s+/g, ' ').trim()).filter(Boolean)
  return { items }
})()`)
report.menuShot = await shot('2-menu')
await evaluate(`(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })()`)

report.week = await evaluate(`(async () => {
  document.querySelector('#modeWeek')?.click()
  await new Promise(r => setTimeout(r, 1800))
  const box = document.querySelector('#weekFilm')
  const text = box ? box.innerText.replace(/\\s+/g, ' ') : ''
  return { hasFeatureWord: text.includes('花絮'), snippet: text.slice(0, 200) }
})()`)
report.weekShot = await shot('3-week')

console.log(JSON.stringify(report, null, 2))
ws.close()
child.kill()
await sleep(1000)
process.exit(0)
