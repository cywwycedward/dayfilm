// 监督用：v3 验收（剪辑发现、故事线候选、模型通道设置、检索时间词）。
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync, mkdirSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(process.env.TEMP ?? root, 'dfv3')
mkdirSync(outDir, { recursive: true })
const PORT = 9361
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

// 1. 日视图：剪辑发现（有空显示，没空隐藏）
report.discoveries = await evaluate(`(() => {
  const box = document.querySelector('#discoveries')
  const items = [...(box?.querySelectorAll('.discovery') ?? [])].map((b) => b.innerText.replace(/\\s+/g, ' ').trim())
  return { hidden: box ? box.hidden : null, count: items.length, items: items.slice(0, 3) }
})()`)
report.dayShot = await shot('1-day')

// 2. 检索：时间词 + 多词
report.search = await evaluate(`(async () => {
  const input = document.querySelector('#search')
  const set = async (value) => {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 700))
    return [...document.querySelectorAll('#list .row, #list li')].length
  }
  const plain = await set('dayfilm')
  const dayWord = await set('昨天')
  const twoWords = await set('dayfilm chatgpt')
  input.value = ''
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 400))
  return { plain, dayWord, twoWords }
})()`)

// 3. 设置：模型通道字段 + 故事线候选
report.settings = await evaluate(`(async () => {
  document.querySelector('#settings')?.click()
  await new Promise((r) => setTimeout(r, 900))
  const panel = document.querySelector('#panel')
  const text = panel ? panel.innerText.replace(/\\s+/g, ' ') : ''
  const fields = ['aiEnabled', 'aiBaseUrl', 'aiModel', 'aiKey', 'aiSave', 'aiProbe', 'findCandidates', 'aiCandidates', 'candidateList']
  return {
    open: !!panel,
    hasModelChannel: text.includes('模型通道'),
    hasCandidates: text.includes('故事线候选'),
    privacyNotice: text.includes('数据会离开这台机器'),
    fields: Object.fromEntries(fields.map((id) => [id, !!document.querySelector('#' + id)]))
  }
})()`)

report.candidates = await evaluate(`(async () => {
  document.querySelector('#findCandidates')?.click()
  await new Promise((r) => setTimeout(r, 2500))
  const list = document.querySelector('#candidateList')
  const rows = [...(list?.querySelectorAll('.candidate') ?? [])].map((row) => ({
    name: row.querySelector('.candidate__name')?.textContent,
    meta: row.querySelector('.candidate__meta')?.textContent,
    source: row.querySelector('.candidate__source')?.textContent
  }))
  return { rows: rows.slice(0, 4), hint: document.querySelector('#candidateHint')?.textContent }
})()`)
report.candidatesShot = await shot('2-candidates')

// 4. 模型通道保存 + key 保留 + 测试连接（指向一个必然失败的端口，验证降级文案）
report.ai = await evaluate(`(async () => {
  const before = await window.dayfilm.getSettings()
  const set = (id, value) => {
    const el = document.querySelector('#' + id)
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  document.querySelector('#aiEnabled').click()
  set('aiBaseUrl', 'http://127.0.0.1:9/v1')
  set('aiModel', 'probe-model')
  set('aiKey', 'sk-probe')
  document.querySelector('#aiSave').click()
  await new Promise((r) => setTimeout(r, 900))
  const saved = await window.dayfilm.getSettings()
  // 只改模型名、key 留空：不能把已有 key 抹掉
  set('aiModel', 'probe-model-2')
  document.querySelector('#aiSave').click()
  await new Promise((r) => setTimeout(r, 900))
  const kept = await window.dayfilm.getSettings()
  document.querySelector('#aiProbe').click()
  await new Promise((r) => setTimeout(r, 2500))
  const status = document.querySelector('#aiStatus')?.textContent
  const placeholder = document.querySelector('#aiKey')?.placeholder
  // 复原：不把探针配置留在用户机器上
  document.querySelector('#aiEnabled').click()
  set('aiBaseUrl', '')
  set('aiModel', '')
  document.querySelector('#aiSave').click()
  await new Promise((r) => setTimeout(r, 600))
  document.querySelector('#aiKeyClear').click()
  await new Promise((r) => setTimeout(r, 700))
  const restored = await window.dayfilm.getSettings()
  return {
    before: before.ai,
    saved: { enabled: saved.ai.enabled, baseUrl: saved.ai.baseUrl, model: saved.ai.model, hasKey: saved.ai.apiKey.length > 0 },
    keyKeptOnResave: kept.ai.apiKey.length > 0 && kept.ai.model === 'probe-model-2',
    probeStatus: status,
    keyPlaceholder: placeholder,
    restored: { enabled: restored.ai.enabled, baseUrl: restored.ai.baseUrl, model: restored.ai.model, keyEmpty: restored.ai.apiKey === '' }
  }
})()`)

await evaluate(`(() => { const body = document.querySelector('#panel .panel__body'); if (body) body.scrollTop = body.scrollHeight })()`)
await sleep(400)
report.probeShot = await shot('3-model')

console.log(JSON.stringify(report, null, 2))
ws.close()
child.kill()
await sleep(1000)
process.exit(0)
