import { describe, expect, it } from 'vitest'
import {
  TRAY_ICON_FILES,
  pauseMenuLabel,
  resolveTrayMood,
  trayIconFile,
  trayMood,
  trayStatusLabel,
  trayTooltip,
  type TrayMood,
  type TrayState
} from '../../src/main/tray/tooltip'

const IDLE: TrayState = { paused: false, captureError: null, storageError: null, hudVisible: true, activeMs: 0 }
const ALL: ReadonlySet<TrayMood> = new Set<TrayMood>(['active', 'paused', 'error'])

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

describe('托盘图标三态', () => {
  it('状态 → 图标文件', () => {
    expect(trayIconFile(IDLE, ALL)).toBe('tray.png')
    expect(trayIconFile({ ...IDLE, paused: true }, ALL)).toBe('tray-paused.png')
    expect(trayIconFile({ ...IDLE, captureError: '中断' }, ALL)).toBe('tray-error.png')
    expect(trayIconFile({ ...IDLE, storageError: 'ENOSPC' }, ALL)).toBe('tray-error.png')
  })

  it('出错优先于已暂停', () => {
    expect(trayMood({ ...IDLE, paused: true, captureError: '中断' })).toBe('error')
    expect(trayIconFile({ ...IDLE, paused: true, captureError: '中断' }, ALL)).toBe('tray-error.png')
  })

  it('图标文件名与三种状态一一对应', () => {
    expect(Object.keys(TRAY_ICON_FILES).sort()).toEqual(['active', 'error', 'paused'])
    expect(TRAY_ICON_FILES.active).toBe('tray.png')
  })

  it('缺少某个状态的图标时回落到 tray.png', () => {
    const onlyActive = new Set<TrayMood>(['active'])
    expect(trayIconFile({ ...IDLE, paused: true }, onlyActive)).toBe('tray.png')
    expect(trayIconFile({ ...IDLE, captureError: '中断' }, onlyActive)).toBe('tray.png')
    expect(resolveTrayMood({ ...IDLE, paused: true }, onlyActive)).toBe('active')
    // 采集中图标自己缺失时也返回 active（调用方会因此判定托盘不可用）
    expect(trayIconFile(IDLE, new Set<TrayMood>())).toBe('tray.png')
  })

  it('部分缺失时只回落缺的那一种', () => {
    const noPaused = new Set<TrayMood>(['active', 'error'])
    expect(trayIconFile({ ...IDLE, paused: true }, noPaused)).toBe('tray.png')
    expect(trayIconFile({ ...IDLE, captureError: '中断' }, noPaused)).toBe('tray-error.png')
  })

  it('图标状态与文字状态同一个判断', () => {
    const states: TrayState[] = [
      IDLE,
      { ...IDLE, paused: true },
      { ...IDLE, captureError: '中断' },
      { ...IDLE, storageError: 'ENOSPC' },
      { ...IDLE, paused: true, storageError: 'ENOSPC' }
    ]
    for (const state of states) {
      expect(TRAY_ICON_FILES[trayMood(state)]).toBe(trayIconFile(state, ALL))
    }
  })
})
