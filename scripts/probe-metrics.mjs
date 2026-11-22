// 监督用：交付版的启动、空闲 CPU 与内存指标。
// 用法: node scripts/probe-metrics.mjs [空闲秒数=30]
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const idleSeconds = Number(process.argv[2] ?? 30)
const PORT = 9336
const startedAt = Date.now()
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const child = spawn(electron, ['.', `--remote-debugging-port=${PORT}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''
child.stdout.on('data', (d) => (logs += d))
child.stderr.on('data', (d) => (logs += d))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function target() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const f = list.find((t) => t.type === 'page' && t.url.startsWith('file:'))
      if (f) return f
    } catch {}
    await sleep(100)
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
const evaluate = (expression) =>
  new Promise((resolve, reject) => {
    seq += 1
    pending.set(seq, { resolve, reject })
    ws.send(JSON.stringify({ id: seq, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  }).then((r) => {
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  })

// 首帧可交互：页面导航会替换执行上下文，先等它稳定，再用两帧确认。
let interactiveMs = null
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    await evaluate('1')
    await evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
    interactiveMs = Date.now() - startedAt
    break
  } catch {
    await sleep(150)
  }
}
if (interactiveMs === null) throw new Error('renderer never became evaluable')

const sample = () => {
  const script = [
    "$out=@()",
    "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | ForEach-Object {",
    "  $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue",
    "  if ($p) { $out += [pscustomobject]@{ pid=$p.Id; rss=$p.WorkingSet64; cpu=$p.TotalProcessorTime.TotalMilliseconds } }",
    "}",
    '$out | ConvertTo-Json -Compress'
  ].join('\n')
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim()
  if (!raw) return { rss: 0, cpu: 0, procs: 0 }
  const list = raw.startsWith('[') ? JSON.parse(raw) : [JSON.parse(raw)]
  return {
    rss: list.reduce((s, p) => s + p.rss, 0),
    cpu: list.reduce((s, p) => s + p.cpu, 0),
    procs: list.length
  }
}

await sleep(1500)
// --hidden：模拟“窗口收进托盘”的常驻状态（R16 的空闲口径）
if (process.argv.includes('--hidden')) {
  await evaluate('window.close()')
  await sleep(2500)
}
const baseline = sample()
const idleStart = Date.now()
await sleep(idleSeconds * 1000)
const after = sample()
const wall = Date.now() - idleStart
const cores = (await import('node:os')).cpus().length
const cpuPercent = ((after.cpu - baseline.cpu) / wall) * 100

// 隐藏窗口后渲染进程是否还活着：决定“从托盘打开”能不能立刻显示
let pagesAfterHide = null
if (process.argv.includes('--hidden')) {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  pagesAfterHide = list.filter((t) => t.type === 'page' && t.url.startsWith('file:')).length
}

console.log(
  JSON.stringify(
    {
      startupToInteractiveMs: interactiveMs,
      idleWindowSeconds: idleSeconds,
      idleCpuPercent: Number(cpuPercent.toFixed(2)),
      idleCpuPercentOfOneCore: Number((cpuPercent / cores * 100).toFixed(2)),
      cores,
      rssAtStartMB: Number((baseline.rss / 1024 / 1024).toFixed(0)),
      rssAfterIdleMB: Number((after.rss / 1024 / 1024).toFixed(0)),
      electronProcesses: after.procs,
      pagesAfterHide
    },
    null,
    2
  )
)

ws.close()
child.kill()
await sleep(1500)
const noise = logs.split('\n').filter((l) => l.trim() && !l.includes('DevTools listening')).slice(0, 10)
if (noise.length) console.log('--- app logs ---\n' + noise.join('\n'))
process.exit(0)
