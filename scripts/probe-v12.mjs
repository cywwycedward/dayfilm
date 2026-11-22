// 监督用：v1.2 一周电影验收（周模式、七日叙事弧、故事线带、评语、精选）。
// 用法: node scripts/probe-v12.mjs <输出png>
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const shotPath = process.argv[2] ?? join(root, 'shot-v12.png')
const PORT = 9343
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const child = spawn(electron, ['.', `--remote-debugging-port=${PORT}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function target() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const f = list.find((t) => t.type === 'page' && t.url.startsWith('file:'))
      if (f) return f
    } catch {}
    await sleep(200)
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

await sleep(4500)
const report = {}

report.controls = await evaluate(`({
  modeButtons: [...document.querySelectorAll('#modeDay,#modeWeek')].map(b => ({ id: b.id, text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed') })),
  weekHiddenBefore: document.querySelector('#weekFilm')?.hidden ?? null
})`)

report.enterWeek = await evaluate(`(async () => {
  document.querySelector('#modeWeek').click()
  await new Promise(r => setTimeout(r, 1200))
  return {
    weekHidden: document.querySelector('#weekFilm')?.hidden ?? null,
    range: document.querySelector('#weekRange')?.innerText?.replace(/\\s+/g, ' ').trim(),
    arcs: document.querySelectorAll('#weekArcs > *').length,
    arcTexts: [...document.querySelectorAll('#weekArcs > *')].slice(0, 3).map(el => el.innerText.replace(/\\s+/g, ' ').trim().slice(0, 60)),
    storylineRows: document.querySelectorAll('#storyline [data-line]').length,
    cells: document.querySelectorAll('#storyline [data-date]').length,
    verdict: document.querySelector('#weekVerdict')?.innerText?.replace(/\\s+/g, ' ').trim(),
    evidence: document.querySelector('#weekEvidence')?.innerText?.replace(/\\s+/g, ' ').trim().slice(0, 120),
    picks: document.querySelectorAll('#weekPicks > *').length,
    pickTexts: [...document.querySelectorAll('#weekPicks > *')].slice(0, 3).map(el => el.innerText.replace(/\\s+/g, ' ').trim().slice(0, 70))
  }
})()`)

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
report.screenshot = shotPath

report.prevWeek = await evaluate(`(async () => {
  const before = document.querySelector('#weekRange')?.innerText?.trim()
  document.querySelector('#weekPrev').click()
  await new Promise(r => setTimeout(r, 1200))
  const after = document.querySelector('#weekRange')?.innerText?.trim()
  const verdict = document.querySelector('#weekVerdict')?.innerText?.replace(/\\s+/g, ' ').trim()
  document.querySelector('#weekToday').click()
  await new Promise(r => setTimeout(r, 900))
  return { before, after, verdict, back: document.querySelector('#weekRange')?.innerText?.trim() }
})()`)

report.cellJump = await evaluate(`(async () => {
  const cell = [...document.querySelectorAll('#storyline [data-date]')].find(c => c.getAttribute('data-count') !== '0') 
    ?? document.querySelector('#storyline [data-date]')
  const date = cell?.getAttribute('data-date')
  cell?.click()
  await new Promise(r => setTimeout(r, 1200))
  return {
    clickedDate: date,
    weekHidden: document.querySelector('#weekFilm')?.hidden ?? null,
    modeDayPressed: document.querySelector('#modeDay')?.getAttribute('aria-pressed'),
    selectedDate: document.querySelector('#date')?.value,
    listRows: document.querySelectorAll('#list > li').length
  }
})()`)

report.pickJump = await evaluate(`(async () => {
  document.querySelector('#modeWeek').click()
  await new Promise(r => setTimeout(r, 1200))
  const pick = document.querySelector('#weekPicks > *')
  const text = pick?.innerText?.replace(/\\s+/g, ' ').trim().slice(0, 50)
  pick?.click()
  await new Promise(r => setTimeout(r, 1300))
  return { text, weekHidden: document.querySelector('#weekFilm')?.hidden ?? null, selectedDate: document.querySelector('#date')?.value, activeRow: document.querySelector('#list .is-active')?.getAttribute('data-id') ?? null }
})()`)

console.log(JSON.stringify(report, null, 2))
ws.close()
child.kill()
await sleep(1200)
process.exit(0)
