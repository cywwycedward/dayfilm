// 监督用：v2.5 验收（导演剪辑版标记、日历题材色相、首次引导）。
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync, mkdirSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(process.env.TEMP ?? root, 'dfv25')
mkdirSync(outDir, { recursive: true })
const PORT = 9352
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

report.markFlow = await evaluate(`(async () => {
  const api = window.dayfilm
  const day = await api.getDay()
  const shot = day.scenes.find((s) => s.kind === 'shot')
  if (!shot) return { error: 'no shot scene' }
  const before = { featureMs: day.featureMs, extraMs: day.extraMs, start: shot.start, seconds: shot.seconds }
  const marked = await api.setMark(day.date, shot.start, 'extra')
  const markedScene = marked.scenes.find((s) => s.start === shot.start)
  const after = { featureMs: marked.featureMs, extraMs: marked.extraMs, mark: markedScene?.mark ?? null }
  return { before, after }
})()`)

await sleep(800)
report.markShot = await shot('1-marked')

report.markClear = await evaluate(`(async () => {
  const day = await window.dayfilm.getDay()
  const scene = day.scenes.find((s) => s.mark === 'extra')
  if (!scene) return { error: 'no marked scene' }
  const cleared = await window.dayfilm.setMark(day.date, scene.start, null)
  return { extraMs: cleared.extraMs, mark: cleared.scenes.find((s) => s.start === scene.start)?.mark ?? null }
})()`)

report.calendar = await evaluate(`(async () => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '日历')
  if (!btn) return { error: 'no calendar entry' }
  btn.click()
  await new Promise(r => setTimeout(r, 2500))
  const cells = [...document.querySelectorAll('#calendar [data-date]')]
  const withStyle = cells.map(c => c.getAttribute('style') || '').filter(s => s.includes('hsl') || s.includes('hsl('))
  return { cells: cells.length, colored: withStyle.length, sample: withStyle.slice(0, 3) }
})()`)
report.calendarShot = await shot('2-calendar')

console.log(JSON.stringify(report, null, 2))
ws.close()
child.kill()
await sleep(1000)
process.exit(0)
