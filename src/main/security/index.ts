/** 安全边界的纯判断，方便单测；Electron 只负责把事实传进来。 */
import { realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface TrustedOrigin {
  /** 开发模式下 electron-vite 起的 devserver 地址 */
  devUrl?: string
  /** 打包/预览时窗口加载的 index.html 的 file:// 地址 */
  rendererFileUrl: string
}

export interface LocalRequestOptions {
  /** 只有开发模式（存在 devserver）才放行回环 http(s)/ws(s)，打包后一律取消 */
  allowLoopback: boolean
}

const OFFLINE_PROTOCOLS = new Set(['data:', 'blob:', 'devtools:', 'chrome-extension:', 'chrome:'])
const NETWORK_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:'])
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** 去掉 hash 与查询串，只比较"哪个页面"。 */
function normalizeUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    url.hash = ''
    url.search = ''
    return url.href
  } catch {
    return null
  }
}

/**
 * 展开成真实路径。Windows 便携版把整份程序解压到 %TEMP%，`__dirname` 可能拿到
 * 8.3 短名（ADMINI~1），而 Chromium 上报的是展开后的长路径；asar 内部的路径不在
 * 文件系统里，所以逐级向上退到最近一个真实存在的目录再拼回去。
 */
export function expandRealPath(target: string): string {
  let current = dirname(target)
  const rest: string[] = [basename(target)]
  for (let step = 0; step < 16; step += 1) {
    try {
      return join(realpathSync.native(current), ...rest)
    } catch {
      const parent = dirname(current)
      if (parent === current) break
      rest.unshift(basename(current))
      current = parent
    }
  }
  return target
}

/** file: 地址的比较键：真实路径 + 反斜杠 + 小写（Windows 路径大小写不敏感）。 */
function fileKey(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'file:') return null
    return expandRealPath(fileURLToPath(url)).replace(/\//g, '\\').toLowerCase()
  } catch {
    return null
  }
}

/** 只接受本应用页面发起的 IPC：devserver 地址，或本地 index.html。 */
export function isTrustedFrameUrl(frameUrl: string, origin: TrustedOrigin): boolean {
  const url = normalizeUrl(frameUrl)
  if (!url) return false
  if (origin.devUrl) {
    const dev = normalizeUrl(origin.devUrl)
    if (dev) {
      const prefix = dev.endsWith('/') ? dev : `${dev}/`
      if (url === dev || url.startsWith(prefix)) return true
    }
  }
  const expected = normalizeUrl(origin.rendererFileUrl)
  if (!expected) return false
  if (url === expected) return true
  const actualKey = fileKey(url)
  return actualKey !== null && actualKey === fileKey(expected)
}

/** 有窗口、有页面地址、页面可信——三条都成立才算可信来源。 */
export function isTrustedSenderInfo(info: { frameUrl: string; hasWindow: boolean }, origin: TrustedOrigin): boolean {
  if (!info.hasWindow) return false
  if (info.frameUrl.length === 0) return false
  return isTrustedFrameUrl(info.frameUrl, origin)
}

/**
 * 只放行本地来源（规格 R15.5）。
 * - `file:` 仅限 host 为空的本机路径；`file://host/share` 会走 SMB，按网络访问处理。
 * - 回环 http(s)/ws(s) 只在开发模式放行（vite HMR 需要），打包后一律取消。
 */
export function isLocalRequest(rawUrl: string, options: LocalRequestOptions): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol === 'file:') return url.host.length === 0
    if (OFFLINE_PROTOCOLS.has(url.protocol)) return true
    if (!NETWORK_PROTOCOLS.has(url.protocol)) return false
    return options.allowLoopback && LOOPBACK_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}
