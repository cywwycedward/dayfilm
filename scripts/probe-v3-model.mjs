// 监督用：用真实配置跑一次模型通道（测试连接 + 用模型补充候选）。
// 只读界面与设置，不改设置；截图落在 %TEMP%\dfv3m。
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync, mkdirSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(process.env.TEMP ?? root, 'dfv3m')
mkdirSync(outDir, { recursive: true })
const PORT = 9371
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
if (!page) {
  console.error('未找到主窗口页面')
  child.kill()
  process.exit(1)
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

report.config = await evaluate(`(async () => {
  const s = await window.dayfilm.getSettings()
  return { enabled: s.ai.enabled, baseUrl: s.ai.baseUrl, model: s.ai.model, hasKey: s.ai.apiKey.length > 0 }
})()`)

// 打开设置并滚到模型区
await evaluate(`(async () => {
  document.querySelector('#settings')?.click()
  await new Promise((r) => setTimeout(r, 900))
  const body = document.querySelector('#panel .panel__body')
  if (body) body.scrollTop = body.scrollHeight
  await new Promise((r) => setTimeout(r, 300))
})()`)

report.probe = await evaluate(`(async () => {
  document.querySelector('#aiProbe')?.click()
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    const text = document.querySelector('#aiStatus')?.textContent ?? ''
    if (text.length > 0 && !text.includes('正在连接')) break
  }
  return { status: document.querySelector('#aiStatus')?.textContent }
})()`)

// 用模型补充候选：点按钮后最多等 60 秒（20 秒超时 + 渲染）
report.aiStories = await evaluate(`(async () => {
  const start = Date.now()
  document.querySelector('#aiCandidates')?.click()
  let rows = []
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    rows = [...document.querySelectorAll('#candidateList .candidate')]
    const status = document.querySelector('#panelStatus')?.textContent ?? ''
    if (rows.length > 0 && !status.includes('正在')) break
    if (Date.now() - start > 55000) break
  }
  return {
    ms: Date.now() - start,
    rows: rows.map((row) => ({
      name: row.querySelector('.candidate__name')?.textContent,
      meta: row.querySelector('.candidate__meta')?.textContent,
      source: row.querySelector('.candidate__source')?.textContent,
      example: row.querySelector('.candidate__example')?.textContent
    })),
    hint: document.querySelector('#candidateHint')?.textContent,
    panelStatus: document.querySelector('#panelStatus')?.textContent,
    aiStatus: document.querySelector('#aiStatus')?.textContent
  }
})()`)

report.shot = await shot('model-run')

console.log(JSON.stringify(report, null, 2))
ws.close()
child.kill()
await sleep(1000)
process.exit(0)
