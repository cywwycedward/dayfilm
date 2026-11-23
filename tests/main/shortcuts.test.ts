import { describe, expect, it } from 'vitest'
import { SHORTCUT_ACCELERATORS, registerShortcuts, type ShortcutHost } from '../../src/main/shortcuts'

interface Harness {
  host: ShortcutHost
  registered: Array<{ accelerator: string; callback: () => void }>
  countUnregisterAll(): number
}

function harness(options: { refuse?: string[]; throwOn?: string[] } = {}): Harness {
  const registered: Array<{ accelerator: string; callback: () => void }> = []
  let unregisterAllCalls = 0
  const host: ShortcutHost = {
    register(accelerator, callback) {
      if (options.throwOn?.includes(accelerator)) throw new Error('boom')
      if (options.refuse?.includes(accelerator)) return false
      registered.push({ accelerator, callback })
      return true
    },
    unregisterAll() {
      unregisterAllCalls += 1
    }
  }
  return { host, registered, countUnregisterAll: () => unregisterAllCalls }
}

describe('SHORTCUT_ACCELERATORS', () => {
  it('R54 的两个快捷键', () => {
    expect(SHORTCUT_ACCELERATORS).toEqual({
      toggleHud: 'CommandOrControl+Alt+D',
      toggleProjection: 'CommandOrControl+Alt+P'
    })
  })
})

describe('registerShortcuts', () => {
  it('全部注册成功：把动作接到回调上', () => {
    const calls: string[] = []
    const test = harness()
    const result = registerShortcuts(test.host, {
      toggleHud: () => calls.push('hud'),
      toggleProjection: () => calls.push('projection')
    })
    expect(result.failures).toEqual([])
    expect(test.registered.map((entry) => entry.accelerator)).toEqual([
      'CommandOrControl+Alt+D',
      'CommandOrControl+Alt+P'
    ])
    for (const entry of test.registered) entry.callback()
    expect(calls).toEqual(['hud', 'projection'])
  })

  it('被占用时只记进 failures，其余照常注册，不抛错', () => {
    const calls: string[] = []
    const test = harness({ refuse: ['CommandOrControl+Alt+D'] })
    const result = registerShortcuts(test.host, {
      toggleHud: () => calls.push('hud'),
      toggleProjection: () => calls.push('projection')
    })
    expect(result.failures).toEqual(['CommandOrControl+Alt+D'])
    expect(test.registered.map((entry) => entry.accelerator)).toEqual(['CommandOrControl+Alt+P'])
    test.registered[0].callback()
    expect(calls).toEqual(['projection'])
  })

  it('register 抛错也当成没注册上，不影响另一个', () => {
    const test = harness({ throwOn: ['CommandOrControl+Alt+P'] })
    const result = registerShortcuts(test.host, { toggleHud: () => {}, toggleProjection: () => {} })
    expect(result.failures).toEqual(['CommandOrControl+Alt+P'])
    expect(test.registered).toHaveLength(1)
  })

  it('两个都失败时 failures 有两项，也不抛错', () => {
    const test = harness({ refuse: ['CommandOrControl+Alt+D', 'CommandOrControl+Alt+P'] })
    const result = registerShortcuts(test.host, { toggleHud: () => {}, toggleProjection: () => {} })
    expect(result.failures).toHaveLength(2)
    expect(test.registered).toEqual([])
  })

  it('unregisterAll 透传到宿主', () => {
    const test = harness()
    const result = registerShortcuts(test.host, { toggleHud: () => {}, toggleProjection: () => {} })
    result.unregisterAll()
    expect(test.countUnregisterAll()).toBe(1)
  })
})
