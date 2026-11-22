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
