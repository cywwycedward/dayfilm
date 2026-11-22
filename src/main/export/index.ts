/** 导出路径归一：规格 R15.3 / R24.3 要求扩展名固定。 */
export function ensureExtension(filePath: string, extension: string): string {
  const suffix = extension.startsWith('.') ? extension : `.${extension}`
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`${escaped}$`, 'i').test(filePath)) return filePath
  // 只去掉最后一段里的扩展名；目录名里的点（C:\a.b\name）不算。
  return `${filePath.replace(/\.[^./\\]*$/, '')}${suffix}`
}

export function ensureMarkdownPath(filePath: string): string {
  return ensureExtension(filePath, 'md')
}
