// 监督用的界面快照工具：不启动主进程逻辑，只把构建好的界面渲染出来截图。
// 用法: npx electron scripts/shot.cjs <输出png> [宽 高]
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')
const { writeFileSync, mkdirSync } = require('node:fs')
const { dirname } = require('node:path')

const out = process.argv[2] || join(__dirname, '..', 'shot.png')
const width = Number(process.argv[3] || 1440)
const height = Number(process.argv[4] || 900)

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    backgroundColor: '#08090c',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false }
  })
  await win.loadFile(join(__dirname, '..', 'out', 'renderer', 'index.html'))
  await new Promise((r) => setTimeout(r, 2500))
  const image = await win.webContents.capturePage()
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, image.toPNG())
  console.log('saved ' + out)
  app.exit(0)
})
