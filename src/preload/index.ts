import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type DayfilmApi } from '../shared/ipc'
import type { LiveState } from '../shared/types'
import { HUD_OPEN_CHANNEL } from '../main/ipc'

const api: DayfilmApi = {
  getDay: (date) => ipcRenderer.invoke(IPC.getDay, date),
  listDays: () => ipcRenderer.invoke(IPC.listDays),
  live: () => ipcRenderer.invoke(IPC.live),
  search: (query) => ipcRenderer.invoke(IPC.search, query),
  exportScreenplay: (date) => ipcRenderer.invoke(IPC.exportScreenplay, date),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  getNote: (date) => ipcRenderer.invoke(IPC.getNote, date),
  setNote: (date, text) => ipcRenderer.invoke(IPC.setNote, date, text),
  saveImage: (defaultName, pngBase64) => ipcRenderer.invoke(IPC.saveImage, defaultName, pngBase64),
  exportEdl: (date) => ipcRenderer.invoke(IPC.exportEdl, date),
  setHud: (visible) => ipcRenderer.invoke(IPC.setHud, visible),
  quit: () => ipcRenderer.invoke(IPC.quit),
  onTick: (cb) => {
    const handler = (_e: unknown, state: LiveState): void => cb(state)
    ipcRenderer.on(IPC.tick, handler)
    return () => ipcRenderer.removeListener(IPC.tick, handler)
  }
}

contextBridge.exposeInMainWorld('dayfilm', api)

/**
 * HUD 页面专用单向通道：单击 HUD 打开主窗口。
 * 不属于 `DayfilmApi`（契约由主 Agent 维护），只暴露这一个动作。
 */
export interface HudBridge {
  open(): void
}

contextBridge.exposeInMainWorld('dayfilmHud', {
  open: () => ipcRenderer.send(HUD_OPEN_CHANNEL)
} satisfies HudBridge)
