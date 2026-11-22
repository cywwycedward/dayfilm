// 监督用：验证采集子进程被杀后的自恢复。
// 用法: node scripts/probe-recovery.mjs
import { spawn, execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 9334
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const child = spawn(electron, ['.', `--remote-debugging-port=${PORT}`], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe']
})
child.stdout.on('data', () => {})
child.stderr.on('data', () => {})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function capturePids() {
  // 过滤串用拼接构造，否则命令行里出现 "capture.ps1" 字面量会让 helper 自己命中；同时排除自身 pid。
  const script =
    "$n='capture'+'.ps1'; " +
    "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | " +
    'Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($n) } | ' +
    'ForEach-Object { $_.ProcessId }'
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' })
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
}

async function page() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const found = list.find((t) => t.type === 'page' && t.url.startsWith('file:'))
      if (found) return found
    } catch {}
    await sleep(250)
  }
  throw new Error('no page target')
}

const target = await page()
const ws = new WebSocket(target.webSocketDebuggerUrl)
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
  }).then((r) => (r.exceptionDetails ? Promise.reject(new Error(JSON.stringify(r.exceptionDetails))) : r.result.value))

await sleep(6000)
const before = await evaluate('(async () => { const s = await window.dayfilm.live(); return { capturing: s.capturing, error: s.captureError } })()')
const pidsBefore = capturePids()
for (const pid of pidsBefore) {
  spawn('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' })
}
await sleep(1200)
const during = await evaluate('(async () => { const s = await window.dayfilm.live(); return { capturing: s.capturing, error: s.captureError } })()')
await sleep(8000)
const after = await evaluate('(async () => { const s = await window.dayfilm.live(); return { capturing: s.capturing, error: s.captureError } })()')
const pidsAfter = capturePids()

console.log(JSON.stringify({ before, killed: pidsBefore, during, after, pidsAfter }, null, 2))
ws.close()
child.kill()
await sleep(1000)
process.exit(0)
