// 监督用：启动构建产物，通过 DevTools 协议读取真实渲染结果并截图。
// 用法: node scripts/probe-app.mjs <screen.png>
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const shotPath = process.argv[2] ?? join(root, 'shot.png')
const PORT = 9333

const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const child = spawn(electron, ['.', `--remote-debugging-port=${PORT}`], {
  cwd: root,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
})
let logs = ''
child.stdout.on('data', (d) => (logs += d))
child.stderr.on('data', (d) => (logs += d))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function target() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && t.url.startsWith('file:'))
      if (page) return page
    } catch {
      /* 端口还没起来 */
    }
    await sleep(250)
  }
  throw new Error('no page target')
}

const page = await target()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})
let seq = 0
const pending = new Map()
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  const waiter = pending.get(msg.id)
  if (!waiter) return
  pending.delete(msg.id)
  if (msg.error) waiter.reject(new Error(JSON.stringify(msg.error)))
  else waiter.resolve(msg.result)
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    seq += 1
    pending.set(seq, { resolve, reject })
    ws.send(JSON.stringify({ id: seq, method, params }))
  })

const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails))
  return res.result.value
}

const report = {}
await sleep(2500)
report.shell = await evaluate(`({
  title: document.title,
  h1: document.querySelector('h1')?.textContent?.trim() ?? null,
  live: document.querySelector('[data-live]')?.textContent?.replace(/\\s+/g,' ').trim() ?? null,
  api: typeof window.dayfilm,
  buttons: [...document.querySelectorAll('button')].map(b => b.textContent.replace(/\\s+/g,' ').trim()).slice(0, 12)
})`)

// 等两轮 tick，确保真实采样进入界面
await sleep(5000)

report.api = await evaluate(`(async () => {
  const live = await window.dayfilm.live()
  const days = await window.dayfilm.listDays()
  const day = await window.dayfilm.getDay()
  return {
    capturing: live.capturing,
    captureError: live.captureError,
    liveScene: live.scene && { exe: live.scene.exe, title: live.scene.title, seconds: live.scene.seconds },
    days,
    scenes: day.scenes.length,
    firstScene: day.scenes[0] ?? null,
    activeMs: day.activeMs,
    cuts: day.cuts,
    verdict: day.verdict.label
  }
})()`)

report.dom = await evaluate(`({
  reelCanvas: !!document.querySelector('canvas'),
  reelWidth: document.querySelector('canvas')?.width ?? 0,
  sceneRows: document.querySelectorAll('.shot, [data-scene]').length,
  bodyText: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 400)
})`)

const shot = await send('Page.captureScreenshot', { format: 'png' })
mkdirSync(dirname(shotPath), { recursive: true })
writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
report.screenshot = shotPath

console.log(JSON.stringify(report, null, 2))

ws.close()
child.kill()
await sleep(1200)
if (logs.trim()) console.log('--- app logs ---\n' + logs.split('\n').filter((l) => !l.includes('vite')).slice(0, 40).join('\n'))
process.exit(0)
