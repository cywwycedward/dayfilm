import { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { describeError, describeWriteError } from '../errors'
import { isEmptyPdf } from './index'

/** A4 纵向的横向像素尺寸，只是给隐藏窗口一个合理初始大小。 */
const PAGE_WIDTH = 794
const PAGE_HEIGHT = 1123
/** 等字体与布局就绪的上限：隐藏窗口里 rAF 可能被节流，卡住就照常打印。 */
const SETTLE_TIMEOUT_MS = 3000

/**
 * 页面内等待：字体就绪 + 两帧 rAF，确保首帧真的画过再打印
 * （否则隐藏窗口会打出一张空白页）。
 */
const SETTLE_SCRIPT = `(async () => {
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready } catch (error) { /* 字体 API 缺失时直接往下走 */ }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))
  return document.readyState
})()`

/** 打印结果是白纸时用的哨兵：不能被外层统一包成 "打印失败：Error"。 */
class EmptyPdfError extends Error {}

function describeFailure(error: unknown): string {
  return error && typeof error === 'object' && (error as NodeJS.ErrnoException).code
    ? describeWriteError(error)
    : describeError(error)
}

function waitForLoad(win: BrowserWindow, html: string): Promise<void> {
  const finished = new Promise<void>((resolve, reject) => {
    win.webContents.once('did-finish-load', () => resolve())
    win.webContents.once('did-fail-load', (_event, code, description) => reject(new Error(`${code} ${description}`)))
  })
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  return finished
}

async function settle(win: BrowserWindow): Promise<void> {
  const ready = win.webContents.executeJavaScript(SETTLE_SCRIPT).catch(() => undefined)
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, SETTLE_TIMEOUT_MS))
  // 谁先到都行：字体/两帧就绪，或等够了直接打
  await Promise.race([ready, timeout])
}

/**
 * 用隐藏窗口把自包含 HTML 打成 A4 PDF 并写盘（规格 R53.3）。
 * 渲染/打印/写盘任一步失败都抛可读错误（不含标题原文），窗口一定会销毁；
 * 打印结果小到不可信时判为失败，不静默写出一张白纸。
 */
export async function writePdf(html: string, target: string): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    // 隐藏窗口默认会被节流，打出来可能就是白页
    paintWhenInitiallyHidden: true,
    webPreferences: {
      backgroundThrottling: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  let phase = '渲染'
  try {
    await waitForLoad(win, html)
    await settle(win)

    phase = '打印'
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: false,
      landscape: false,
      margins: { marginType: 'default' }
    })
    if (isEmptyPdf(pdf)) throw new EmptyPdfError()

    phase = '写盘'
    await writeFile(target, pdf)
  } catch (error) {
    if (error instanceof EmptyPdfError) throw new Error('PDF 生成失败：内容为空')
    throw new Error(`PDF ${phase}失败：${describeFailure(error)}`)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
