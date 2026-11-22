import { describe, expect, it } from 'vitest'
import { isLocalRequest, isTrustedFrameUrl, isTrustedSenderInfo } from '../../src/main/security'

const ORIGIN = {
  devUrl: 'http://localhost:5174/',
  rendererFileUrl: 'file:///D:/app/out/renderer/index.html'
}

describe('isTrustedFrameUrl', () => {
  it('开发模式放行 devserver 页面', () => {
    expect(isTrustedFrameUrl('http://localhost:5174/', ORIGIN)).toBe(true)
    expect(isTrustedFrameUrl('http://localhost:5174/index.html?x=1#y', ORIGIN)).toBe(true)
    expect(isTrustedFrameUrl('http://localhost:5174/src/app.ts', ORIGIN)).toBe(true)
  })

  it('其它端口、远程页面一律拒绝', () => {
    expect(isTrustedFrameUrl('http://localhost:9999/', ORIGIN)).toBe(false)
    expect(isTrustedFrameUrl('https://evil.example/', ORIGIN)).toBe(false)
    expect(isTrustedFrameUrl('http://localhost:5174.evil.example/', ORIGIN)).toBe(false)
  })

  it('打包后的本地页面放行，其它 file 页面拒绝', () => {
    expect(isTrustedFrameUrl('file:///D:/app/out/renderer/index.html', ORIGIN)).toBe(true)
    expect(isTrustedFrameUrl('file:///D:/app/out/renderer/index.html#/scene', ORIGIN)).toBe(true)
    expect(isTrustedFrameUrl('file:///C:/Windows/evil.html', ORIGIN)).toBe(false)
  })

  it('空串与非法 URL 不可信', () => {
    expect(isTrustedFrameUrl('', ORIGIN)).toBe(false)
    expect(isTrustedFrameUrl('not a url', ORIGIN)).toBe(false)
  })

  it('非开发模式不接受 devserver 页面', () => {
    expect(isTrustedFrameUrl('http://localhost:5174/', { rendererFileUrl: ORIGIN.rendererFileUrl })).toBe(false)
  })
})

describe('isTrustedSenderInfo', () => {
  it('有窗口 + 本应用页面才可信', () => {
    expect(
      isTrustedSenderInfo({ frameUrl: ORIGIN.rendererFileUrl, hasWindow: true }, { rendererFileUrl: ORIGIN.rendererFileUrl })
    ).toBe(true)
    expect(
      isTrustedSenderInfo({ frameUrl: ORIGIN.rendererFileUrl, hasWindow: false }, { rendererFileUrl: ORIGIN.rendererFileUrl })
    ).toBe(false)
    expect(isTrustedSenderInfo({ frameUrl: '', hasWindow: true }, ORIGIN)).toBe(false)
    expect(isTrustedSenderInfo({ frameUrl: 'https://evil.example/', hasWindow: true }, ORIGIN)).toBe(false)
  })
})

describe('isLocalRequest', () => {
  const DEV = { allowLoopback: true }
  const PACKAGED = { allowLoopback: false }

  it('本机文件与离线协议放行', () => {
    const allowed = [
      'file:///D:/app/out/renderer/index.html',
      'file:///C:/Program%20Files/Dayfilm/resources/app.asar/out/renderer/index.html',
      'data:image/png;base64,AAAA',
      'blob:file:///D:/app/out/renderer/still',
      'devtools://devtools/bundled/inspector.html'
    ]
    for (const url of allowed) expect(isLocalRequest(url, PACKAGED), url).toBe(true)
  })

  it('UNC 形式的 file: 拒绝（file://host/share 等于走 SMB）', () => {
    expect(isLocalRequest('file://server/share/page.html', DEV)).toBe(false)
    expect(isLocalRequest('file://attacker.example/out/renderer/index.html', DEV)).toBe(false)
    expect(isLocalRequest('file:///D:/app/out/renderer/index.html', DEV)).toBe(true)
  })

  it('回环网络只在开发模式放行', () => {
    for (const url of ['http://localhost:5174/@vite/client', 'ws://localhost:5174/', 'http://127.0.0.1:5173/', 'http://[::1]:5173/']) {
      expect(isLocalRequest(url, DEV), url).toBe(true)
      expect(isLocalRequest(url, PACKAGED), url).toBe(false)
    }
  })

  it('远程来源一律拒绝', () => {
    const blocked = [
      'https://example.com/x',
      'http://10.0.0.5/x',
      'https://www.googletagmanager.com/gtag.js',
      'wss://example.com/socket',
      'ftp://localhost/x',
      ''
    ]
    for (const url of blocked) expect(isLocalRequest(url, DEV), url).toBe(false)
  })
})
