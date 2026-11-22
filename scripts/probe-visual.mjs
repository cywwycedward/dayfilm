// 视觉评审用：一次跑出四张截图（日视图、放映、周视图、放大帧），供人眼判断。
// 用法: node scripts/probe-visual.mjs [输出目录]
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync, mkdirSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = process.argv[2] ?? join(process.env.TEMP ?? root, 'dayfilm-visual')
mkdirSync(outDir, { recursive: true })
const PORT = 9345
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
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  const path = join(outDir, `${name}.png`)
  writeFileSync(path, Buffer.from(r.data, 'base64'))
  return path
}

await sleep(5000)
const files = {}
files.day = await shot('1-day')

// 选中一个镜头，看放大帧
files.frame = await evaluate(`(async () => {
  const rows = [...document.querySelectorAll('#list > li button')]
  rows[Math.min(2, rows.length - 1)]?.click()
  await new Promise(r => setTimeout(r, 600))
  return document.querySelector('#frameTitle')?.textContent ?? null
})()`)
files.frameShot = await shot('2-frame')

// 进入放映
await evaluate(`(async () => { document.querySelector('#play')?.click(); await new Promise(r => setTimeout(r, 400)); return true })()`)
await sleep(1800)
files.projection = await shot('3-projection')
files.projectionState = await evaluate(`({
  projection: !!document.querySelector('#projection') && !document.querySelector('#projection').hidden,
  counter: document.querySelector('#shotCounter')?.textContent?.trim() ?? null,
  title: document.querySelector('#projectionTitle')?.textContent?.trim() ?? null
})`)

// 退出放映，切周视图
await evaluate(`(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(r => setTimeout(r, 500)); document.querySelector('#modeWeek')?.click(); await new Promise(r => setTimeout(r, 1400)); return true })()`)
files.week = await shot('4-week')

console.log(JSON.stringify(files, null, 2))
ws.close()
child.kill()
await sleep(1000)
process.exit(0)
