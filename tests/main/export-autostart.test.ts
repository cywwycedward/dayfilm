import { describe, expect, it } from 'vitest'
import { loginItemSettings } from '../../src/main/autostart'
import { ensureMarkdownPath } from '../../src/main/export'

describe('ensureMarkdownPath', () => {
  it('已经以 .md 结尾就原样返回（大小写不敏感）', () => {
    expect(ensureMarkdownPath('C:\\out\\dayfilm-2026-11-22.md')).toBe('C:\\out\\dayfilm-2026-11-22.md')
    expect(ensureMarkdownPath('C:\\out\\dayfilm.MD')).toBe('C:\\out\\dayfilm.MD')
  })

  it('用户手输别的扩展名时改成 .md', () => {
    expect(ensureMarkdownPath('C:\\out\\dayfilm.txt')).toBe('C:\\out\\dayfilm.md')
    expect(ensureMarkdownPath('C:\\out\\dayfilm.tar.gz')).toBe('C:\\out\\dayfilm.tar.md')
    expect(ensureMarkdownPath('/home/u/dayfilm.2026')).toBe('/home/u/dayfilm.md')
  })

  it('没有扩展名时补上', () => {
    expect(ensureMarkdownPath('C:\\out\\dayfilm')).toBe('C:\\out\\dayfilm.md')
    expect(ensureMarkdownPath('C:\\out.d\\dayfilm')).toBe('C:\\out.d\\dayfilm.md')
  })

  it('目录名里的点不会被当成扩展名', () => {
    expect(ensureMarkdownPath('C:\\a.b\\dayfilm')).toBe('C:\\a.b\\dayfilm.md')
  })
})

describe('loginItemSettings', () => {
  it('普通安装用 process.execPath', () => {
    expect(loginItemSettings(true, {}, 'C:\\Program Files\\Dayfilm\\Dayfilm.exe')).toEqual({
      openAtLogin: true,
      path: 'C:\\Program Files\\Dayfilm\\Dayfilm.exe',
      args: ['--hidden']
    })
  })

  it('portable 目标用 PORTABLE_EXECUTABLE_FILE 指向用户手里的 exe', () => {
    const env = { PORTABLE_EXECUTABLE_FILE: 'D:\\tools\\Dayfilm-portable.exe' }
    expect(loginItemSettings(false, env, 'C:\\Users\\x\\AppData\\Local\\Temp\\2Nx1\\Dayfilm.exe')).toEqual({
      openAtLogin: false,
      path: 'D:\\tools\\Dayfilm-portable.exe',
      args: ['--hidden']
    })
  })

  it('portable 变量为空串时回落到 process.execPath', () => {
    expect(loginItemSettings(true, { PORTABLE_EXECUTABLE_FILE: '' }, 'C:\\app\\Dayfilm.exe').path).toBe('C:\\app\\Dayfilm.exe')
  })
})
