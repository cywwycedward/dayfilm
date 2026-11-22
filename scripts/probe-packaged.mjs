// 监督用：验证打包产物（win-unpacked 或 portable exe）能起、IPC 通道在 asar 路径下仍通。
// 用法: node scripts/probe-packaged.mjs <exe path> [截屏路径]
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const exe = process.argv[2]
if (!exe) {
  console.error('usage: node scripts/probe-packaged.mjs <exe> [png]')
  process.exit(2)
}
const shotPath = process.argv[3] ?? join(root, 'shot-packaged.png')
const PORT = 9340
const child = spawn(exe, [`--remote-debugging-port=${PORT}`], { cwd: dirname(exe), stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''
child.stdout.on('data', (d) => (logs += d))
child.stderr.on('data', (d) => (logs += d))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function target() {
  for (let i = 0; i < 160; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const f = list.find((t) => t.type === 'page')
      if (f) return f
    } catch {}
    await sleep(250)
  }
  throw new Error('no page target')
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

await sleep(6000)
const report = { exe, pageUrl: page.url }
report.shell = await evaluate(`({
  title: document.title,
  hasApi: typeof window.dayfilm,
  bodyText: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 220)
})`)
report.ipc = await evaluate(`(async () => {
  try {
    const live = await window.dayfilm.live()
    const days = await window.dayfilm.listDays()
    const settings = await window.dayfilm.getSettings()
    const day = await window.dayfilm.getDay()
    return {
      ok: true,
      capturing: live.capturing,
      captureError: live.captureError,
      storageError: live.storageError,
      paused: live.paused,
      liveScene: live.scene && live.scene.exe,
      days,
      scenes: day.scenes.length,
      settings
    }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})()`)
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
report.screenshot = shotPath
console.log(JSON.stringify(report, null, 2))
ws.close()
child.kill()
await sleep(1500)
const tail = logs.split('\n').filter((l) => l.trim() && !l.includes('DevTools listening')).slice(0, 12)
if (tail.length) console.log('--- app logs ---\n' + tail.join('\n'))
process.exit(0)
