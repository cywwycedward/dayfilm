/** 解码后允许的最大体积（规格 R24.x：海报是 1600×1000 PNG，20 MB 足够）。 */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
/** IPC 入参只做体积上限（base64 比原始字节大约 4/3）。 */
export const MAX_BASE64_LENGTH = 40 * 1024 * 1024

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]
const ILLEGAL_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g

/**
 * 解码 base64 并校验 PNG：不合格（非字符串、不是 base64、不是 PNG magic、超过上限）
 * 一律返回 null，调用方回 `{ path: '' }`。
 */
export function decodePngBase64(value: unknown, maxBytes = MAX_IMAGE_BYTES): Buffer | null {
  if (typeof value !== 'string') return null
  const compact = value.trim()
  if (compact.length === 0) return null
  // 先按体积粗判，避免为超大输入分配内存
  if (Math.floor((compact.length * 3) / 4) > maxBytes + 3) return null
  const bytes = Buffer.from(compact, 'base64')
  if (bytes.length === 0 || bytes.length > maxBytes) return null
  for (let index = 0; index < PNG_MAGIC.length; index += 1) {
    if (bytes[index] !== PNG_MAGIC[index]) return null
  }
  return bytes
}

/** 默认文件名只留文件名部分，去掉目录分隔符与 Windows 非法字符，扩展名固定 `.png`。 */
export function sanitizeImageName(value: unknown, fallback = 'dayfilm'): string {
  const raw = typeof value === 'string' ? value : ''
  const tail = raw.split(/[\\/]/).pop() ?? ''
  const cleaned = tail
    .replace(ILLEGAL_NAME_CHARS, '')
    .replace(/\.png$/i, '')
    .trim()
    .replace(/^\.+/, '')
    .trim()
  const base = cleaned.length > 0 ? cleaned.slice(0, 80) : fallback
  return `${base}.png`
}
