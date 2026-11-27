// 监督用：v4 界面验收（上一集、中场休息一句话、镜头之后、剪辑子计数、检索范围与理由）。
// 用独立 userData + 两天的合成采样，不碰本机真实数据。用法: node scripts/probe-v4.mjs
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outDir = join(process.env.TEMP ?? root, `dfv4-${stamp}`)
const userData = join(outDir, 'userData')
mkdirSync(join(userData, 'days'), { recursive: true })

const PORT = 9400 + Math.floor(Math.random() * 400)
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const at = (day, hour, minute = 0) => {
  const d = new Date(day)
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}

/** 一段连续停留：每 2 秒一条采样。 */
function hold(rows, t, minutes, exe, title, idleMs = 500) {
  for (let i = 0; i < (minutes * 60) / 2; i += 1) {
    rows.push({ t: t + i * 2000, exe, title, idleMs })
  }
  return t + minutes * 60_000
}

const CODE = 'dayfilm — Visual Studio Code'
const today = new Date()
const viewed = new Date(today.getTime() - 86_400_000)
const earlier = new Date(today.getTime() - 3 * 86_400_000)
const viewedKey = iso(viewed)
const earlierKey = iso(earlier)

// 前一次出现的那一天：同一个标题，40 分钟。
{
  const rows = []
  hold(rows, at(earlier, 14, 0), 40, 'Code', CODE)
  writeFileSync(join(userData, 'days', `${earlierKey}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
}

// 被查看的那一天：31 分钟长镜头 → 15 分钟内的三次停留 → 20 分钟中场休息 → 回到原窗口。
{
  const rows = []
  let t = at(viewed, 9, 0)
  t = hold(rows, t, 31, 'Code', CODE)
  t = hold(rows, t, 2, 'Chrome', 'GitHub')
  t = hold(rows, t, 1, 'Code', CODE)
  t = hold(rows, t, 2, 'Code', 'README.md — Visual Studio Code')
  t = hold(rows, t, 20, 'Code', CODE) // 休息前最后一条：与休息后同窗口
  t = hold(rows, at(viewed, 10, 0), 20, '', '', 500) // away 采样：空闲值故意很小，只靠空 exe/title 判中场
  t = hold(rows, t, 30, 'Code', CODE)
  writeFileSync(join(userData, 'days', `${viewedKey}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
}

const child = spawn(electron, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe']
})
let stderrTail = ''
child.stderr?.setEncoding('utf8')
child.stderr?.on('data', (chunk) => {
  stderrTail = `${stderrTail}${chunk}`.slice(-2000)
})

let page
for (let i = 0; i < 120 && !page; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    page = list.find((t) => t.type === 'page' && t.url.endsWith('/index.html'))
  } catch {}
  if (!page) await sleep(200)
}
if (!page) {
  console.error('未找到主窗口页面，端口', PORT, 'stderr:', stderrTail)
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

await sleep(4000)
const report = {}

// 打开被查看的那一天（日期是自绘下拉框：先点触发器，再点目标选项）。
const viewedLabel = `${viewed.getMonth() + 1}月${viewed.getDate()}日`
report.day = await evaluate(`(async () => {
  const root = document.querySelector('#date')
  root.querySelector('.select__trigger').click()
  await new Promise((r) => setTimeout(r, 300))
  const options = [...root.querySelectorAll('[role="option"]')]
  const target = options.find((o) => o.textContent.includes(${JSON.stringify(viewedLabel)}))
  if (!target) return { error: '找不到日期选项', options: options.map((o) => o.textContent) }
  // 自绘下拉框在 pointerdown 上提交，click 不生效
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 1400))
  const row = document.querySelector('#episode')
  const rest = document.querySelector('#intermission')
  const rows = [...document.querySelectorAll('#discoveries > *')]
  return {
    date: document.querySelector('.select__value')?.textContent,
    episodeHidden: row.hidden,
    episodeText: row.textContent,
    intermissionText: rest.hidden ? null : rest.textContent,
    discoveryLabels: rows.map((r) => r.querySelector('.discovery__label')?.textContent),
    discoveryTexts: rows.map((r) => r.querySelector('.discovery__text')?.textContent),
    stats: [...document.querySelectorAll('#metrics .metric')].map((m) => m.textContent),
    statCuts: document.querySelector('#statCuts').hidden ? null : document.querySelector('#statCutsValue').textContent,
    genre: document.querySelector('#genre')?.textContent
  }
})()`)
report.dayShot = await shot('1-day')

// 检索：普通词、时间词、超出保留范围。
report.search = await evaluate(`(async () => {
  const input = document.querySelector('#search')
  const run = async (query) => {
    input.value = query
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 1000))
    const reasons = [...document.querySelectorAll('.shot__reason')].map((n) => n.textContent)
    return { count: document.querySelectorAll('#list > li').length, reasons, empty: document.querySelector('#empty').hidden ? null : document.querySelector('#empty').textContent }
  }
  const byWord = await run('dayfilm')
  const byDate = await run(${JSON.stringify(`${viewed.getMonth() + 1}月${viewed.getDate()}日`)})
  const expired = await run('2024-03-05')
  input.value = ''
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 600))
  return { byWord, byDate, expired }
})()`)
report.searchShot = await shot('2-search')

console.log(JSON.stringify(report, null, 2))
ws.close()
child.kill()
await sleep(1200)
try {
  rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
} catch {
  // 目录被系统索引之类占着不影响验收，留着下次清理
}
process.exit(0)
