import { describe, expect, it } from 'vitest'
import { describeError, describeWriteError } from '../../src/main/errors'

function withCode(code: string): NodeJS.ErrnoException {
  const error = new Error('boom') as NodeJS.ErrnoException
  error.code = code
  return error
}

describe('describeWriteError', () => {
  it('常见写盘错误码翻成一句人话', () => {
    expect(describeWriteError(withCode('EACCES'))).toBe('没有写入权限（EACCES）')
    expect(describeWriteError(withCode('EPERM'))).toBe('没有写入权限（EPERM）')
    expect(describeWriteError(withCode('EISDIR'))).toBe('目标是一个文件夹（EISDIR）')
    expect(describeWriteError(withCode('EROFS'))).toBe('目标位置是只读的（EROFS）')
    expect(describeWriteError(withCode('ENOSPC'))).toBe('磁盘空间不足（ENOSPC）')
    expect(describeWriteError(withCode('ENOENT'))).toBe('目标目录不存在（ENOENT）')
    expect(describeWriteError(withCode('EBUSY'))).toBe('文件被其他程序占用（EBUSY）')
  })

  it('未收录的错误码与未知对象保持原样', () => {
    expect(describeWriteError(withCode('EWHATEVER'))).toBe('EWHATEVER')
    expect(describeWriteError(new TypeError('x'))).toBe('TypeError')
    expect(describeWriteError('nope')).toBe('未知错误')
  })

  it('文案里不带标题或路径', () => {
    const error = withCode('EACCES') as NodeJS.ErrnoException & { path?: string }
    error.path = 'C:\\Users\\x\\Documents\\secret-title.md'
    expect(describeWriteError(error)).not.toContain('secret-title')
    expect(describeWriteError(error)).not.toContain('C:\\')
  })

  it('describeError 仍然只给代码', () => {
    expect(describeError(withCode('EACCES'))).toBe('EACCES')
  })
})
