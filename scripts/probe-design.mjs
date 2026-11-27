// 设计用探针：用独立的 userData（复制当前 days/settings）启动第二个实例，
// 截主界面与设置面板四段，并真跑一次「用模型补充」。结束删除临时目录。
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(process.env.TEMP ?? root, 'dfdesign')
const userData = join(outDir, 'userData')
mkdirSync(outDir, { recursive: true })
rmSync(userData, { recursive: true, force: true })

const live = join(process.env.APPDATA ?? '', 'dayfilm')
cpSync(join(live, 'days'), join(userData, 'days'), { recursive: true })
for (const file of ['settings.json', 'notes.json', 'marks.json']) {
  if (existsSync(join(live, file))) cpSync(join(live, file), join(userData, file))
}

const PORT = 9381
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const child = spawn(electron, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe']
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let page
for (let i = 0; i < 150 && !page; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    page = list.find((t) => t.type === 'page' && t.url.endsWith('/index.html'))
  } catch {}
  if (!page) await sleep(200)
}
if (!page) {
  console.error('未找到主窗口页面（可能被单实例锁拦下）')
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
report.shots = []
report.shots.push(await shot('ui-1-day'))

// 设置面板：逐个分区截图（分区导航 + 单分区内容）
await evaluate(`(async () => {
  document.querySelector('#settings')?.click()
  await new Promise((r) => setTimeout(r, 900))
})()`)
const panes = [
  ['采集', 'collect'],
  ['项目', 'projects'],
  ['模型', 'model'],
  ['常驻', 'resident'],
  ['系统', 'system']
]
report.projects = []
// 先在临时实例里加两条规则，才能看到行状态与行内编辑（不写回真实设置）
for (const [name, terms] of [['dayfilm', 'dayfilm'], ['设计', 'figma、notion']]) {
  await evaluate(`(async () => {
    const form = document.querySelector('#projectForm')
    const [nameInput, termsInput] = form.querySelectorAll('input')
    nameInput.value = ${JSON.stringify(name)}
    termsInput.value = ${JSON.stringify(terms)}
    form.requestSubmit()
    await new Promise((r) => setTimeout(r, 600))
  })()`)
}
report.shots.push(await shot('ui-7-projects'))
// 行内编辑态
await evaluate(`(async () => {
  document.querySelector('[data-project-edit]')?.click()
  await new Promise((r) => setTimeout(r, 300))
})()`)
report.projects.push(await evaluate(`(() => {
  const row = document.querySelector('.project--editing')
  return { editing: !!row, inputs: row ? [...row.querySelectorAll('input')].map((i) => i.value) : [] }
})()`))
report.shots.push(await shot('ui-8-project-edit'))
await evaluate(`(async () => {
  document.querySelector('[data-project-cancel]')?.click()
  await new Promise((r) => setTimeout(r, 250))
})()`)
report.panes = []
for (const [label, section] of panes) {
  const shown = await evaluate(`(async () => {
    document.querySelector('#settingsNav [data-section="${section}"]')?.click()
    await new Promise((r) => setTimeout(r, 250))
    return {
      active: document.querySelector('#settingsNav .nav-item.is-active')?.dataset.section,
      visible: [...document.querySelectorAll('#settingsPane [data-pane]')].filter((p) => !p.hidden).map((p) => p.dataset.pane),
      text: document.querySelector('#settingsPane')?.innerText.replace(/\\s+/g, ' ').slice(0, 100)
    }
  })()`)
  report.panes.push({ label, ...shown })
  report.shots.push(await shot(`ui-pane-${panes.findIndex(([name]) => name === label) + 1}`))
}
// 回到模型分区真跑一次「用模型补充」
await evaluate(`(async () => {
  document.querySelector('#settingsNav [data-section="model"]')?.click()
  await new Promise((r) => setTimeout(r, 200))
})()`)
report.shots.push(await shot('ui-2-settings-top'))

// 960×640 最小窗口：抽屉应该收到 420 / 导航 96
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 640, deviceScaleFactor: 1, mobile: false })
await sleep(500)
report.narrowWidth = await evaluate(`document.querySelector('#panel')?.getBoundingClientRect().width`)
report.shots.push(await shot('ui-6-narrow'))
await send('Emulation.clearDeviceMetricsOverride')
await sleep(300)

// 真跑一次「用模型补充」：验证成功路径的界面
report.ai = await evaluate(`(async () => {
  const start = Date.now()
  const button = document.querySelector('#aiCandidates')
  const disabled = button?.disabled
  button?.click()
  let rows = []
  for (let i = 0; i < 50; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    rows = [...document.querySelectorAll('#candidateList .candidate')]
    const status = document.querySelector('#panelStatus')?.textContent ?? ''
    if (rows.length > 0 && !status.includes('正在')) break
  }
  return {
    buttonDisabled: disabled,
    ms: Date.now() - start,
    rows: rows.map((row) => ({
      name: row.querySelector('input.candidate__name')?.value,
      meta: row.querySelector('.candidate__meta')?.textContent,
      source: row.querySelector('.candidate__source')?.textContent,
      example: row.querySelector('.candidate__example')?.textContent
    })),
    hint: document.querySelector('#candidateHint')?.textContent,
    status: document.querySelector('#panelStatus')?.textContent,
    // 模型候选落地后应自动切回「项目」分区
    sectionAfter: document.querySelector('#settingsNav .nav-item.is-active')?.textContent,
    drawerWidth: document.querySelector('#panel')?.getBoundingClientRect().width
  }
})()`)
report.shots.push(await shot('ui-5-model-candidates'))

console.log(JSON.stringify(report, null, 2))
ws.close()
child.kill()
await sleep(1200)
// 只删复制出来的 userData（里面有 settings 副本），截图保留给设计评审用
rmSync(userData, { recursive: true, force: true })
process.exit(0)
