// 监督用：真实 IPC 下的交互验收（日期切换、检索），并截图。
// 用法: node scripts/probe-ui.mjs <输出png>
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync, existsSync, unlinkSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const shotPath = process.argv[2] ?? join(root, 'shot-ui.png')
const PORT = 9335
const APPDATA = process.env.APPDATA
const daysDir = join(APPDATA, 'dayfilm', 'days')

const iso = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const yesterday = new Date(Date.now() - 86_400_000)
const yKey = iso(yesterday)
const yFile = join(daysDir, `${yKey}.jsonl`)

// 用昨天的合成采样验证历史日通道：三段真实窗口 + 一段空闲
function synth() {
  const base = new Date(yesterday)
  base.setHours(9, 0, 0, 0)
  const t0 = base.getTime()
  const rows = []
  const plan = [
    ['Code', 'dayfilm — src/main/reel/index.ts', 180],
    ['chrome', 'MDN Canvas API', 90],
    ['Code', 'dayfilm — src/renderer/src/app.ts', 240]
  ]
  let t = t0
  for (const [exe, title, n] of plan) {
    for (let i = 0; i < n; i += 1) {
      rows.push({ t, exe, title, idleMs: 500 })
      t += 2000
    }
  }
  return rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
}
const existed = existsSync(yFile)
if (!existed) writeFileSync(yFile, synth(), 'utf8')

const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const child = spawn(electron, ['.', `--remote-debugging-port=${PORT}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''
child.stdout.on('data', (d) => (logs += d))
child.stderr.on('data', (d) => (logs += d))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function target() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const f = list.find((t) => t.type === 'page' && t.url.startsWith('file:'))
      if (f) return f
    } catch {}
    await sleep(250)
  }
  throw new Error('no page')
}
const page = await target()
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
  m.error ? w.reject(new Error(JSON.stringify(m.error))) : w.resolve(m.result)
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

await sleep(5000)
const report = {}
report.today = await evaluate(`({
  dates: [...document.querySelectorAll('#date option')].map(o => o.textContent.trim()),
  genre: document.querySelector('#genre')?.textContent,
  rows: document.querySelectorAll('#list > li').length
})`)

report.history = await evaluate(`(async () => {
  const sel = document.querySelector('#date')
  sel.value = ${JSON.stringify(yKey)}
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  await new Promise(r => setTimeout(r, 900))
  return {
    picked: sel.value,
    title: document.querySelector('#reelTitle')?.textContent,
    genre: document.querySelector('#genre')?.textContent,
    verdict: document.querySelector('#verdict')?.textContent,
    rows: [...document.querySelectorAll('#list > li')].length,
    firstRow: document.querySelector('#list > li')?.innerText?.replace(/\\s+/g, ' ').trim(),
    metrics: document.querySelector('#metrics')?.innerText?.replace(/\\s+/g, ' ').trim()
  }
})()`)

report.search = await evaluate(`(async () => {
  const input = document.querySelector('#search')
  input.value = 'canvas'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 900))
  return {
    listTitle: document.querySelector('#listTitle')?.textContent,
    count: document.querySelectorAll('#list > li').length,
    first: document.querySelector('#list > li')?.innerText?.replace(/\\s+/g, ' ').trim(),
    announce: document.querySelector('#announce')?.textContent
  }
})()`)

report.emptySearch = await evaluate(`(async () => {
  const input = document.querySelector('#search')
  input.value = ''
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 700))
  return { listTitle: document.querySelector('#listTitle')?.textContent, count: document.querySelectorAll('#list > li').length }
})()`)

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
report.screenshot = shotPath
report.yesterdayFile = { path: yFile, removed: !existed }

console.log(JSON.stringify(report, null, 2))
ws.close()
child.kill()
await sleep(1500)
if (!existed && existsSync(yFile)) unlinkSync(yFile)
const tail = logs.split('\n').filter((l) => l.trim() && !l.includes('DevTools listening') && !l.includes('vite')).slice(0, 20)
if (tail.length) console.log('--- app logs ---\n' + tail.join('\n'))
process.exit(0)
