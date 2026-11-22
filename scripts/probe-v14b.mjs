// 监督用：v1.4 补充验收（片头卡需要两天数据；旁白用真实元素 id）。
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync, existsSync, unlinkSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 9347
const daysDir = join(process.env.APPDATA, 'dayfilm', 'days')
const iso = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const yesterday = new Date(Date.now() - 86_400_000)
const yKey = iso(yesterday)
const yFile = join(daysDir, `${yKey}.jsonl`)
const synthetic = () => {
  const base = new Date(yesterday)
  base.setHours(9, 0, 0, 0)
  let t = base.getTime()
  const rows = []
  for (const [exe, title, n] of [
    ['Code', 'dayfilm — src/main/index.ts', 200],
    ['chrome', 'MDN Canvas API', 60]
  ]) {
    for (let i = 0; i < n; i += 1) {
      rows.push(JSON.stringify({ t, exe, title, idleMs: 400 }))
      t += 2000
    }
  }
  return `${rows.join('\n')}\n`
}
const existed = existsSync(yFile)
if (!existed) writeFileSync(yFile, synthetic(), 'utf8')

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
report.dateSwitch = await evaluate(`(async () => {
  const sel = document.querySelector('#date')
  const options = [...sel.options].map(o => o.value).filter(Boolean)
  sel.value = ${JSON.stringify(yKey)}
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  await new Promise(r => setTimeout(r, 250))
  const card = document.querySelector('#titleCard')
  const shot = { options, card: !!card, visible: card ? !card.hidden : false, text: card ? card.innerText.replace(/\\s+/g, ' ').trim().slice(0, 40) : null }
  await new Promise(r => setTimeout(r, 1800))
  shot.goneAfter = card ? card.hidden : true
  return shot
})()`)

report.narration = await evaluate(`(async () => {
  document.querySelector('#play').click()
  await new Promise(r => setTimeout(r, 1300))
  const box = document.querySelector('#projectionSubtitle')
  const idx = document.querySelector('#projectionSubtitleIndex')
  const txt = document.querySelector('#projectionSubtitleText')
  const first = { hidden: box ? box.hidden : null, index: idx ? idx.textContent : null, text: txt ? txt.textContent : null }
  await new Promise(r => setTimeout(r, 3000))
  const second = { index: idx ? idx.textContent : null, text: txt ? txt.textContent : null }
  return { first, second, changed: first.text !== second.text }
})()`)

console.log(JSON.stringify(report, null, 2))
ws.close()
child.kill()
await sleep(1200)
if (!existed && existsSync(yFile)) unlinkSync(yFile)
process.exit(0)
