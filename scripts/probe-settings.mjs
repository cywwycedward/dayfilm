// 监督用：交付版验收——真实 IPC 下走一遍设置面板、暂停/恢复、写入异常字段。
// 用法: node scripts/probe-settings.mjs <输出png>
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const shotPath = process.argv[2] ?? join(root, 'shot-settings.png')
const PORT = 9337
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

await sleep(4000)
const report = {}

report.api = await evaluate(`(async () => {
  const s = await window.dayfilm.getSettings()
  const live = await window.dayfilm.live()
  return { settings: s, paused: live.paused, storageError: live.storageError, capturing: live.capturing }
})()`)

report.openPanel = await evaluate(`(async () => {
  document.querySelector('#settings').click()
  await new Promise(r => setTimeout(r, 400))
  return {
    open: !document.querySelector('#drawer').hidden,
    retention: document.querySelector('#settingRetention')?.value ?? null,
    pausedChecked: document.querySelector('#settingPaused')?.checked ?? null,
    autostartChecked: document.querySelector('#settingAutoStart')?.checked ?? null,
    builtinCount: (document.querySelector('#builtinTerms')?.textContent ?? '').split(/[,，、\\s]+/).filter(Boolean).length,
    text: document.querySelector('#panel').innerText.replace(/\\s+/g, ' ').slice(0, 240)
  }
})()`)

report.addTerm = await evaluate(`(async () => {
  const input = document.querySelector('#termInput')
  input.value = 'e2e-term'
  document.querySelector('#termForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await new Promise(r => setTimeout(r, 700))
  const s = await window.dayfilm.getSettings()
  return { terms: s.redactTerms, chips: document.querySelectorAll('#termChips > *').length }
})()`)

report.pauseOn = await evaluate(`(async () => {
  const box = document.querySelector('#settingPaused')
  box.checked = true
  box.dispatchEvent(new Event('change', { bubbles: true }))
  await new Promise(r => setTimeout(r, 1600))
  const live = await window.dayfilm.live()
  return {
    paused: live.paused,
    capturing: live.capturing,
    chip: document.querySelector('#chipText')?.textContent,
    liveText: document.querySelector('#liveText')?.textContent
  }
})()`)

report.pauseOff = await evaluate(`(async () => {
  const box = document.querySelector('#settingPaused')
  box.checked = false
  box.dispatchEvent(new Event('change', { bubbles: true }))
  await new Promise(r => setTimeout(r, 2600))
  const live = await window.dayfilm.live()
  return { paused: live.paused, capturing: live.capturing }
})()`)

report.cleanup = await evaluate(`(async () => {
  const s = await window.dayfilm.getSettings()
  const kept = s.redactTerms.filter(t => t !== 'e2e-term')
  await window.dayfilm.setSettings({ redactTerms: kept })
  const after = await window.dayfilm.getSettings()
  return { terms: after.terms, retention: after.retentionDays, autostart: after.autoStart, paused: after.paused }
})()`)

report.closePanel = await evaluate(`(async () => {
  document.querySelector('#panelClose').click()
  await new Promise(r => setTimeout(r, 300))
  return { open: !document.querySelector('#drawer').hidden, focused: document.activeElement?.id }
})()`)

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
report.screenshot = shotPath
console.log(JSON.stringify(report, null, 2))
ws.close()
child.kill()
await sleep(1200)
process.exit(0)
