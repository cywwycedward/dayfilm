/** 把异常压成可读的短串：只用错误码或类型名，不含窗口标题、路径等原始内容。 */
export function describeError(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as NodeJS.ErrnoException).code
    if (typeof code === 'string' && code.length > 0) return code
    const name = (error as Error).name
    if (typeof name === 'string' && name.length > 0) return name
  }
  return '未知错误'
}

/** 写盘失败时最常见的几个错误码，翻译成用户看得懂的一句话（仍然不带路径与标题）。 */
const WRITE_FAILURE_HINTS: Record<string, string> = {
  EACCES: '没有写入权限',
  EPERM: '没有写入权限',
  EISDIR: '目标是一个文件夹',
  EROFS: '目标位置是只读的',
  ENOSPC: '磁盘空间不足',
  ENOENT: '目标目录不存在',
  EBUSY: '文件被其他程序占用',
  ENAMETOOLONG: '文件名太长'
}

/** 导出/保存失败的文案：`没有写入权限（EACCES）`，未知错误码原样带出。 */
export function describeWriteError(error: unknown): string {
  const code = error && typeof error === 'object' ? (error as NodeJS.ErrnoException).code : undefined
  const hint = typeof code === 'string' ? WRITE_FAILURE_HINTS[code] : undefined
  return hint ? `${hint}（${code}）` : describeError(error)
}
