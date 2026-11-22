import { BrowserWindow, screen } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { HudSettings } from '../../shared/settings'
import { resolveHudPosition } from './position'

/** 规格 R40.1：360×148 的无边框置顶小窗。 */
export const HUD_WIDTH = 360
export const HUD_HEIGHT = 148
/** 拖动时不要每动一下就写盘（规格 R40.6）。 */
const MOVE_DEBOUNCE_MS = 300

export interface HudOptions {
  /** 当前 HUD 设置（开关 + 上次位置） */
  settings(): HudSettings
  /** 拖动结束后写回位置；失败由调用方处理 */
  savePosition(x: number, y: number): void
  preload: string
  /** 打包产物里 hud.html 的绝对路径 */
  hudFile: string
  /** 开发模式的 devserver 地址（null 表示打包/预览） */
  devUrl?: string
}

export interface HudHandle {
  setVisible(visible: boolean): void
  isVisible(): boolean
  destroy(): void
}

/**
 * 导演 HUD：懒创建、按设置显隐、拖动后写回位置。
 * HUD 页面由界面实现者提供；文件缺失或加载失败时只记一次日志并保持隐藏，不抛错。
 */
export function createHud(options: HudOptions): HudHandle {
  let win: BrowserWindow | null = null
  let moveTimer: NodeJS.Timeout | null = null
  let warned = false
  let available = true

  function warnOnce(message: string, detail: unknown): void {
    if (warned) return
    warned = true
    console.warn(message, detail)
  }

  function loadTarget(): { kind: 'url'; url: string } | { kind: 'file'; path: string } | null {
    if (options.devUrl) {
      return { kind: 'url', url: new URL('hud.html', options.devUrl).toString() }
    }
    if (!existsSync(options.hudFile)) {
      warnOnce('[dayfilm] 导演 HUD 页面缺失，保持隐藏', options.hudFile)
      available = false
      return null
    }
    return { kind: 'file', path: options.hudFile }
  }

  function place(instance: BrowserWindow): void {
    const size = { width: HUD_WIDTH, height: HUD_HEIGHT }
    const workAreas = screen.getAllDisplays().map((display) => display.workArea)
    const primary = screen.getPrimaryDisplay().workArea
    const position = resolveHudPosition(options.settings(), size, workAreas, primary)
    instance.setPosition(position.x, position.y)
  }

  function ensureWindow(): BrowserWindow | null {
    if (win && !win.isDestroyed()) return win
    if (!available) return null

    const target = loadTarget()
    if (!target) return null

    const instance = new BrowserWindow({
      width: HUD_WIDTH,
      height: HUD_HEIGHT,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      show: false,
      focusable: false,
      hasShadow: true,
      fullscreenable: false,
      maximizable: false,
      minimizable: false,
      webPreferences: {
        preload: options.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    win = instance

    // 全屏应用也不该盖住 HUD（规格 R40）。
    instance.setAlwaysOnTop(true, 'screen-saver')
    instance.setVisibleOnAllWorkspaces(true)
    place(instance)

    instance.on('moved', () => {
      if (moveTimer) clearTimeout(moveTimer)
      moveTimer = setTimeout(() => {
        moveTimer = null
        if (!win || win.isDestroyed()) return
        const [x, y] = win.getPosition()
        options.savePosition(x, y)
      }, MOVE_DEBOUNCE_MS)
    })

    instance.webContents.on('did-fail-load', (_event, code, description) => {
      warnOnce('[dayfilm] 导演 HUD 页面加载失败，保持隐藏', `${code} ${description}`)
      available = false
      if (win && !win.isDestroyed()) win.hide()
    })

    instance.on('closed', () => {
      win = null
    })

    if (target.kind === 'url') void instance.loadURL(target.url)
    else void instance.loadFile(target.path)

    return instance
  }

  return {
    setVisible(visible: boolean): void {
      if (!visible) {
        if (win && !win.isDestroyed()) win.hide()
        return
      }
      const instance = ensureWindow()
      if (!instance) return
      place(instance)
      // 不抢焦点：用户正在别的窗口里打字
      instance.showInactive()
    },
    isVisible(): boolean {
      return Boolean(win && !win.isDestroyed() && win.isVisible())
    },
    destroy(): void {
      if (moveTimer) {
        clearTimeout(moveTimer)
        moveTimer = null
      }
      if (win && !win.isDestroyed()) win.destroy()
      win = null
    }
  }
}

/** HUD 页面的默认路径（打包/预览时从 out/main 起算）。 */
export function hudPagePath(mainDir: string): string {
  return join(mainDir, '../renderer/hud.html')
}
