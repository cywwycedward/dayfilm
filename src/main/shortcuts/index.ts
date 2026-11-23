/** 全局快捷键映射（规格 R54）。这里是唯一的加速器清单，注册与测试都用它。 */
export const SHORTCUT_ACCELERATORS = {
  toggleHud: 'CommandOrControl+Alt+D',
  toggleProjection: 'CommandOrControl+Alt+P'
} as const

export type ShortcutAction = keyof typeof SHORTCUT_ACCELERATORS

export interface ShortcutActions {
  /** 显示/隐藏导演 HUD（与设置里的开关同一状态） */
  toggleHud(): void
  /** 打开主窗口并切换放映 */
  toggleProjection(): void
}

/** 可注入的宿主：默认用 Electron 的 `globalShortcut`，测试用假实现。 */
export interface ShortcutHost {
  register(accelerator: string, callback: () => void): boolean
  unregisterAll(): void
}

export interface ShortcutResult {
  /** 注册失败的加速器（被其它程序占用等），界面提示用 */
  failures: string[]
  unregisterAll(): void
}

/**
 * 逐个注册全局快捷键。被占用时只记录、不重试、不抛错——快捷键失败不该拦着应用启动（规格 R54.3）。
 */
export function registerShortcuts(host: ShortcutHost, actions: ShortcutActions): ShortcutResult {
  const failures: string[] = []
  for (const action of Object.keys(SHORTCUT_ACCELERATORS) as ShortcutAction[]) {
    const accelerator = SHORTCUT_ACCELERATORS[action]
    let registered = false
    try {
      registered = host.register(accelerator, () => actions[action]())
    } catch {
      // 某些平台在某些状态下会直接抛错，同样按"没注册上"处理
      registered = false
    }
    if (!registered) failures.push(accelerator)
  }
  return { failures, unregisterAll: () => host.unregisterAll() }
}
