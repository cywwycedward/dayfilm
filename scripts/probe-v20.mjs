// 监督用：v2.0 版式截图（只截图，不做交互）。
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync, mkdirSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = process.argv[2] ?? join(process.env.TEMP ?? root, 'dfv20')
mkdirSync(outDir, { recursive: true })
const PORT = 9351
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
const report = { layout: await evaluate(`({
  hero: !!document.querySelector('.hero'),
  spine: !!document.querySelector('.spine, #spine'),
  rail: !!document.querySelector('.rail, #rail'),
  genre: document.querySelector('#genre')?.textContent ?? null,
  buttons: [...document.querySelectorAll('button')].map(b => b.textContent.replace(/\\s+/g,' ').trim()).filter(Boolean).slice(0, 14),
  bodyText: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300)
})`) }
report.day = await shot('1-day')
await evaluate(`(async () => { document.querySelector('#modeWeek')?.click(); await new Promise(r => setTimeout(r, 1600)); return true })()`)
report.week = await shot('2-week')
await evaluate(`(async () => { document.querySelector('#modeDay')?.click(); await new Promise(r => setTimeout(r, 900)); document.querySelector('#play')?.click(); await new Promise(r => setTimeout(r, 1500)); return true })()`)
report.projection = await shot('3-projection')

console.log(JSON.stringify(report, null, 2))
ws.close()
child.kill()
await sleep(1000)
process.exit(0)
