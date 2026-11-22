// 监督用：v1.1 功能验收（缩放、周视图、项目、手记、高光、海报按钮）。
// 用法: node scripts/probe-v11.mjs <输出png>
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const shotPath = process.argv[2] ?? join(root, 'shot-v11.png')
const PORT = 9342
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

report.inventory = await evaluate(`({
  zoomLevel: document.querySelector('#zoomLevel')?.textContent,
  zoomButtons: ['zoomIn','zoomOut','zoomReset'].filter(id => document.getElementById(id)).length,
  weekCells: document.querySelectorAll('#week > *').length,
  weekActive: document.querySelectorAll('#week .is-active, #week [aria-current]').length,
  projectTotals: document.querySelector('#projectTotals')?.innerText?.replace(/\\s+/g, ' ').trim() ?? null,
  noteField: document.querySelector('#note')?.tagName ?? null,
  noteCount: document.querySelector('#noteCount')?.textContent,
  highlights: document.querySelectorAll('#highlights > *').length,
  posterButton: document.querySelector('#exportPoster')?.textContent?.trim() ?? null,
  ticks: (document.querySelector('#ruler')?.innerText ?? '').replace(/\\s+/g, ' ').trim()
})`)

report.zoom = await evaluate(`(async () => {
  const before = document.querySelector('#ruler')?.innerText?.replace(/\\s+/g, ' ').trim()
  document.querySelector('#zoomIn').click()
  document.querySelector('#zoomIn').click()
  await new Promise(r => setTimeout(r, 400))
  const after = document.querySelector('#ruler')?.innerText?.replace(/\\s+/g, ' ').trim()
  const level = document.querySelector('#zoomLevel')?.textContent
  document.querySelector('#zoomReset').click()
  await new Promise(r => setTimeout(r, 300))
  return { before, after, level, reset: document.querySelector('#zoomLevel')?.textContent }
})()`)

report.week = await evaluate(`(async () => {
  const cells = [...document.querySelectorAll('#week > *')]
  const first = cells[0]
  const beforeDate = document.querySelector('#date')?.value
  const clickable = cells.filter(c => c.tagName === 'BUTTON').length
  if (first && first.tagName === 'BUTTON') { first.click(); await new Promise(r => setTimeout(r, 900)) }
  return { beforeDate, afterDate: document.querySelector('#date')?.value, clickable, cells: cells.length }
})()`)

report.note = await evaluate(`(async () => {
  const box = document.querySelector('#note')
  const date = document.querySelector('#date')?.value
  if (!box) return { error: 'no note field' }
  box.value = 'v1.1 验收手记'
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 1200))
  const saved = await window.dayfilm.getNote(date)
  box.value = ''
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 1000))
  const cleared = await window.dayfilm.getNote(date)
  return { date, saved, cleared, count: document.querySelector('#noteCount')?.textContent }
})()`)

report.projects = await evaluate(`(async () => {
  const s = await window.dayfilm.getSettings()
  const before = s.projects.length
  await window.dayfilm.setSettings({ projects: [{ name: '验收项目', terms: ['msedge'] }] })
  await new Promise(r => setTimeout(r, 900))
  const section = document.querySelector('#projectTotals')?.innerText?.replace(/\\s+/g, ' ').trim()
  await window.dayfilm.setSettings({ projects: s.projects })
  return { before, section, restored: (await window.dayfilm.getSettings()).projects.length }
})()`)
report.projects.after = await evaluate(`document.querySelector('#projectTotals')?.innerText?.replace(/\\s+/g, ' ').trim()`)

report.highlights = await evaluate(`[...document.querySelectorAll('#highlights > *')].map(el => el.innerText.replace(/\\s+/g, ' ').trim()).slice(0, 4)`)

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
report.screenshot = shotPath
console.log(JSON.stringify(report, null, 2))
ws.close()
child.kill()
await sleep(1200)
process.exit(0)
