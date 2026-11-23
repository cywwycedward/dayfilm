/**
 * 无边框窗口的窗口控制。纯编排：目标窗口与发送函数由外部注入，
 * 单测用假窗口即可，不需要真的开一个 Electron 窗口。
 */

export interface WindowControlTarget {
  minimize(): void
  isMaximized(): boolean
  maximize(): void
  unmaximize(): void
  /** 与点系统关闭同一个路径：主进程里 close 事件会 preventDefault + 收进托盘 */
  close(): void
}

export type WindowTargetGetter = () => WindowControlTarget | null

export interface WindowActions {
  minimize(): void
  /** 切换最大化，返回切换后的状态 */
  toggleMaximize(): boolean
  close(): void
}

/** 三个窗口按钮的实现；窗口不存在时静默忽略（例如正在退出）。 */
export function createWindowActions(target: WindowTargetGetter): WindowActions {
  return {
    minimize(): void {
      target()?.minimize()
    },
    toggleMaximize(): boolean {
      const win = target()
      if (!win) return false
      if (win.isMaximized()) {
        win.unmaximize()
        return false
      }
      win.maximize()
      return true
    },
    close(): void {
      // 故意不调 app.quit：close 事件里主进程会拦住并隐藏到托盘（规格 R12.1）
      target()?.close()
    }
  }
}

/** 只需要事件能力的窗口（BrowserWindow 与测试替身都满足）。 */
export interface MaximizeEmitter {
  on(event: 'maximize' | 'unmaximize', listener: () => void): void
  removeListener(event: 'maximize' | 'unmaximize', listener: () => void): void
}

/** `maximize` / `unmaximize` → 一个布尔事件；返回解绑函数。 */
export function bindMaximizeEvents(win: MaximizeEmitter, send: (maximized: boolean) => void): () => void {
  const onMaximize = (): void => send(true)
  const onUnmaximize = (): void => send(false)
  win.on('maximize', onMaximize)
  win.on('unmaximize', onUnmaximize)
  return () => {
    win.removeListener('maximize', onMaximize)
    win.removeListener('unmaximize', onUnmaximize)
  }
}
