// 监督用：验证“关窗进托盘”之后窗口与渲染进程是否还在（能从托盘重新打开）。
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 9338
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const child = spawn(electron, ['.', `--remote-debugging-port=${PORT}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const listTargets = async () => {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    return list.map((t) => ({ type: t.type, url: t.url.slice(0, 60) }))
  } catch (e) {
    return [{ error: String(e) }]
  }
}

async function connect() {
  for (let i = 0; i < 100; i += 1) {
    const list = await listTargets()
    const page = list.find((t) => t.type === 'page' && t.url.startsWith('file:'))
    if (page) {
      const full = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const target = full.find((t) => t.type === 'page' && t.url.startsWith('file:'))
      return target.webSocketDebuggerUrl
    }
    await sleep(200)
  }
  throw new Error('no page')
}

const url = await connect()
const ws = new WebSocket(url)
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
const evaluate = (expression) =>
  new Promise((resolve, reject) => {
    seq += 1
    pending.set(seq, { resolve, reject })
    ws.send(JSON.stringify({ id: seq, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  }).then((r) => (r.exceptionDetails ? Promise.reject(new Error('eval failed')) : r.result.value))

await sleep(4000)
const before = await listTargets()
await evaluate('window.close()')
await sleep(1500)
const after1 = await listTargets()
await sleep(3000)
const after2 = await listTargets()
let evalAfter = null
try {
  evalAfter = await evaluate('document.visibilityState')
} catch (e) {
  evalAfter = String(e.message)
}
console.log(JSON.stringify({ before, after1, after2, evalAfter }, null, 2))
ws.close()
child.kill()
await sleep(1000)
process.exit(0)
