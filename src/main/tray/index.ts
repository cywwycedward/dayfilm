import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron'
import {
  TRAY_ICON_FILES,
  pauseMenuLabel,
  resolveTrayMood,
  trayTooltip,
  type TrayMood,
  type TrayState
} from './tooltip'

export interface TrayActions {
  open(): void
  togglePause(): void
  quit(): void
}

export interface TrayIconPaths {
  active: string
  paused: string
  error: string
}

export interface TrayHandle {
  setState(state: TrayState): void
  destroy(): void
}

export interface TrayOptions {
  icons: TrayIconPaths
  state: TrayState
  actions: TrayActions
}

/** 图标一一对应三种状态；遍历这张表的键，不另外维护一份状态名单。 */
const TRAY_MOODS = Object.keys(TRAY_ICON_FILES) as TrayMood[]

/**
 * 托盘常驻入口。菜单固定三项：打开 / 暂停-继续（勾选项表示"已暂停"）/ 退出。
 * 图标按状态切换；某个状态图标缺失时回落到采集中图标，且只在启动时告警一次
 * （tick 每 2 秒来一次，不能每帧刷日志）。一个图标都读不到就抛错，由调用方兜底。
 */
export function createTray(options: TrayOptions): TrayHandle {
  const images = {} as Record<TrayMood, NativeImage>
  const available = new Set<TrayMood>()
  for (const mood of TRAY_MOODS) {
    const path = options.icons[mood]
    const image = nativeImage.createFromPath(path)
    if (image.isEmpty()) {
      console.warn(`[dayfilm] 托盘图标读取失败，回落到 ${TRAY_ICON_FILES.active}`, path)
      continue
    }
    images[mood] = image
    available.add(mood)
  }
  if (!available.has('active')) throw new Error('托盘图标不可用')

  const tray = new Tray(images.active)
  let state = options.state
  let lastTooltip: string | null = null
  let lastMenuKey: string | null = null
  let lastMood: TrayMood | null = null

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
    // 提示文字、菜单、图标各自只在真的变了才更新：每 2 秒一次 tick 会带来新快照。
    const tooltip = trayTooltip(state)
    if (tooltip !== lastTooltip) {
      lastTooltip = tooltip
      tray.setToolTip(tooltip)
    }

    const menuKey = state.paused ? 'paused' : 'active'
    if (menuKey !== lastMenuKey) {
      lastMenuKey = menuKey
      tray.setContextMenu(Menu.buildFromTemplate(template()))
    }

    const mood = resolveTrayMood(state, available)
    if (mood !== lastMood) {
      lastMood = mood
      tray.setImage(images[mood])
    }
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
