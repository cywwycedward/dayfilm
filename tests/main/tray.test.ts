import { describe, expect, it } from 'vitest'
import { pauseMenuLabel, trayStatusLabel, trayTooltip, type TrayState } from '../../src/main/tray/tooltip'

const IDLE: TrayState = { paused: false, captureError: null, storageError: null, activeMs: 0 }

describe('trayStatusLabel', () => {
  it('采集中 / 已暂停 / 出错', () => {
    expect(trayStatusLabel(IDLE)).toBe('采集中')
    expect(trayStatusLabel({ ...IDLE, paused: true })).toBe('已暂停')
    expect(trayStatusLabel({ ...IDLE, captureError: '采集进程中断' })).toBe('出错')
    expect(trayStatusLabel({ ...IDLE, storageError: '写入异常（ENOSPC）' })).toBe('出错')
  })

  it('出错优先于暂停', () => {
    expect(trayStatusLabel({ ...IDLE, paused: true, storageError: '写入异常' })).toBe('出错')
  })
})

describe('trayTooltip', () => {
  it('状态后附当日已记录时长', () => {
    expect(trayTooltip({ ...IDLE, activeMs: 4_320_000 })).toBe('Dayfilm · 采集中 · 今日 1 小时 12 分钟')
    expect(trayTooltip({ ...IDLE, paused: true, activeMs: 90_000 })).toBe('Dayfilm · 已暂停 · 今日 2 分钟')
  })

  it('没有记录时长时不附', () => {
    expect(trayTooltip(IDLE)).toBe('Dayfilm · 采集中')
  })

  it('提示里不含窗口标题', () => {
    expect(trayTooltip({ ...IDLE, captureError: 'x', activeMs: 0 })).toBe('Dayfilm · 出错')
  })
})

describe('pauseMenuLabel', () => {
  it('菜单文字随状态切换', () => {
    expect(pauseMenuLabel(false)).toBe('暂停采样')
    expect(pauseMenuLabel(true)).toBe('继续采样')
  })
})
