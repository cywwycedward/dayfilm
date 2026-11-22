// 监督用：v1.4 验收（片头卡、放映旁白、HUD 开关）。
// 用法: node scripts/probe-v14.mjs
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 9346
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const child = spawn(electron, ['.', `--remote-debugging-port=${PORT}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pageTarget() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const f = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
      if (f) return f
    } catch {}
    await sleep(200)
  }
  throw new Error('no page')
}
const page = await pageTarget()
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
const evaluate = async (expression) => {
  const r = await new Promise((resolve, reject) => {
    seq += 1
    pending.set(seq, { resolve, reject })
    ws.send(JSON.stringify({ id: seq, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result.value
}

await sleep(5000)
const report = {}

report.titleCard = await evaluate(`(async () => {
  const before = !!document.querySelector('#titleCard')
  const sel = document.querySelector('#date')
  const other = [...sel.options].map(o => o.value).find(v => v && v !== sel.value)
  if (!other) return { before, skipped: 'only one date' }
  sel.value = other
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  await new Promise(r => setTimeout(r, 300))
  const card = document.querySelector('#titleCard')
  const visible = card ? !card.hidden : false
  const text = card ? card.innerText.replace(/\\s+/g, ' ').trim().slice(0, 60) : null
  await new Promise(r => setTimeout(r, 1800))
  const after = document.querySelector('#titleCard')
  return { before, date: other, visible, text, goneAfter: after ? after.hidden : true }
})()`)

report.narration = await evaluate(`(async () => {
  document.querySelector('#play').click()
  await new Promise(r => setTimeout(r, 1200))
  const el = document.querySelector('#projectionNarration') || document.querySelector('[data-narration]')
  const first = el ? el.innerText.replace(/\\s+/g, ' ').trim() : null
  await new Promise(r => setTimeout(r, 2500))
  const second = el ? el.innerText.replace(/\\s+/g, ' ').trim() : null
  return { hasElement: !!el, first, second, changed: first !== second }
})()`)

report.hud = await evaluate(`(async () => {
  const off = await window.dayfilm.setHud(false)
  await new Promise(r => setTimeout(r, 600))
  const on = await window.dayfilm.setHud(true)
  await new Promise(r => setTimeout(r, 600))
  return { off, on }
})()`)

console.log(JSON.stringify(report, null, 2))
ws.close()
child.kill()
await sleep(1200)
process.exit(0)
