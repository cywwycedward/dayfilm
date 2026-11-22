import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron'
import { pauseMenuLabel, trayTooltip, type TrayState } from './tooltip'

export interface TrayActions {
  open(): void
  togglePause(): void
  quit(): void
}

export interface TrayHandle {
  setState(state: TrayState): void
  destroy(): void
}

export interface TrayOptions {
  iconPath: string
  state: TrayState
  actions: TrayActions
}

/**
 * 托盘常驻入口。菜单固定三项：打开 / 暂停-继续（勾选项表示"已暂停"）/ 退出。
 * 图标文件读不到时只告警，不阻塞启动。
 */
export function createTray(options: TrayOptions): TrayHandle {
  const image = nativeImage.createFromPath(options.iconPath)
  if (image.isEmpty()) console.warn('[dayfilm] 托盘图标读取失败', options.iconPath)
  const tray = new Tray(image)
  let state = options.state
  let signature = ''

  const template = (): MenuItemConstructorOptions[] => [
    { label: '打开 Dayfilm', click: () => options.actions.open() },
    { type: 'separator' },
    {
      type: 'checkbox',
      label: pauseMenuLabel(state.paused),
      checked: state.paused,
      click: () => options.actions.togglePause()
    },
    { type: 'separator' },
    { label: '退出', click: () => options.actions.quit() }
  ]

  const render = (): void => {
    // 每 2 秒一次 tick 会带来新快照；只有可见文字变化时才重建菜单，否则会白白重排。
    const next = `${trayTooltip(state)}|${state.paused}`
    if (next === signature) return
    signature = next
    tray.setToolTip(trayTooltip(state))
    tray.setContextMenu(Menu.buildFromTemplate(template()))
  }

  render()
  tray.on('click', () => options.actions.open())

  return {
    setState(next: TrayState): void {
      state = next
      render()
    },
    destroy(): void {
      tray.destroy()
    }
  }
}
