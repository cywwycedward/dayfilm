import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createWindowHandlers, WINDOW_CHANNELS } from '../../src/main/ipc'
import { bindMaximizeEvents, createWindowActions, type WindowControlTarget } from '../../src/main/window-chrome'

/** 假窗口：记录调用，不改真实窗口状态机。 */
function fakeWindow(maximized = false) {
  const calls: string[] = []
  const state = { maximized }
  const target: WindowControlTarget = {
    minimize: () => calls.push('minimize'),
    isMaximized: () => state.maximized,
    maximize: () => {
      state.maximized = true
      calls.push('maximize')
    },
    unmaximize: () => {
      state.maximized = false
      calls.push('unmaximize')
    },
    close: () => calls.push('close')
  }
  return { target, calls, state }
}

describe('createWindowActions', () => {
  it('最小化转发给窗口', () => {
    const { target, calls } = fakeWindow()
    createWindowActions(() => target).minimize()
    expect(calls).toEqual(['minimize'])
  })

  it('toggleMaximize 两个方向都对，并返回切换后的状态', () => {
    const { target, calls, state } = fakeWindow(false)
    const actions = createWindowActions(() => target)

    expect(actions.toggleMaximize()).toBe(true)
    expect(state.maximized).toBe(true)
    expect(actions.toggleMaximize()).toBe(false)
    expect(state.maximized).toBe(false)
    expect(calls).toEqual(['maximize', 'unmaximize'])
  })

  it('窗口不存在时静默忽略（退出过程中可能已经是 null）', () => {
    const actions = createWindowActions(() => null)
    expect(() => actions.minimize()).not.toThrow()
    expect(actions.toggleMaximize()).toBe(false)
    expect(() => actions.close()).not.toThrow()
  })

  it('close 只走窗口的 close，不碰 app.quit', () => {
    const { target, calls } = fakeWindow()
    const quit = vi.fn()
    // 模拟主进程可注入的依赖：窗口动作之外还有一个 quit，窗口按钮不该碰它
    const deps = { actions: createWindowActions(() => target), quit }
    deps.actions.close()
    expect(calls).toEqual(['close'])
    expect(quit).not.toHaveBeenCalled()
  })
})

describe('bindMaximizeEvents', () => {
  it('maximize / unmaximize 广播成布尔值', () => {
    const win = new EventEmitter()
    const sent: boolean[] = []
    bindMaximizeEvents(win, (maximized) => sent.push(maximized))

    win.emit('maximize')
    win.emit('unmaximize')
    expect(sent).toEqual([true, false])
  })

  it('解绑后不再发送，并且真的摘掉了监听', () => {
    const win = new EventEmitter()
    const sent: boolean[] = []
    const unbind = bindMaximizeEvents(win, (maximized) => sent.push(maximized))

    expect(win.listenerCount('maximize')).toBe(1)
    unbind()
    expect(win.listenerCount('maximize')).toBe(0)
    expect(win.listenerCount('unmaximize')).toBe(0)

    win.emit('maximize')
    expect(sent).toEqual([])
  })
})

describe('窗口控制通道', () => {
  it('三个通道各自转发到对应动作，window:close 不调 quit', () => {
    const { target, calls } = fakeWindow()
    const quit = vi.fn()
    const deps = {
      ...createWindowActions(() => target),
      quit
    }
    const handlers = createWindowHandlers(deps)

    expect(Object.keys(handlers).sort()).toEqual([...Object.values(WINDOW_CHANNELS)].sort())

    handlers[WINDOW_CHANNELS.minimize]()
    expect(handlers[WINDOW_CHANNELS.toggleMaximize]()).toEqual({ maximized: true })
    handlers[WINDOW_CHANNELS.close]()

    expect(calls).toEqual(['minimize', 'maximize', 'close'])
    expect(quit).not.toHaveBeenCalled()
  })
})
