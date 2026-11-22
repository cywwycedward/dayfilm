/** 时间轴与时长格式化。全部为纯函数，空数据与非法输入不产生 NaN。 */

const DAY_MS = 86_400_000

function pad2(value: number): string {
  return String(Math.trunc(value)).padStart(2, '0')
}

/** 本地日期字符串 YYYY-MM-DD 对应的当日零点毫秒时间戳。 */
export function startOfDay(dateISO: string): number {
  const [year, month, day] = dateISO.split('-').map((part) => Number(part))
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return 0
  return new Date(year, month - 1, day).getTime()
}

/** 毫秒时间戳对应的本地日期字符串。 */
export function isoDate(ts: number): string {
  const date = new Date(ts)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 当日内比例：00:00 → 0，24:00 → 1，越界与非法输入夹取到边界。 */
export function fractionOfDay(ts: number, dayStart: number): number {
  const fraction = (ts - dayStart) / DAY_MS
  if (!Number.isFinite(fraction)) return 0
  return Math.min(1, Math.max(0, fraction))
}

/** 时刻 → HH:MM。 */
export function fmtClock(ts: number): string {
  if (!Number.isFinite(ts)) return '--:--'
  const date = new Date(ts)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** 时长（秒）→ 中文短标签，例如 "42 秒"、"3 分 05 秒"、"1 小时 12 分"。 */
export function fmtDuration(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0
  if (total < 60) return `${total} 秒`
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  if (minutes < 60) return rest === 0 ? `${minutes} 分` : `${minutes} 分 ${pad2(rest)} 秒`
  const hours = Math.floor(minutes / 60)
  const spare = minutes % 60
  return spare === 0 ? `${hours} 小时` : `${hours} 小时 ${pad2(spare)} 分`
}

/** 毫秒时长 → 汇总用的 "6 小时 12 分"。与主进程剧本同口径：有时长就至少报 1 分钟。 */
export function fmtMinutes(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 分'
  const total = Math.max(1, Math.round(ms / 60_000))
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours === 0) return `${minutes} 分`
  return minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${pad2(minutes)} 分`
}

/** 计时器样式，小时累加不进位，例如 "02:07:41"。 */
export function fmtElapsed(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0
  return `${pad2(Math.floor(total / 3600))}:${pad2(Math.floor((total % 3600) / 60))}:${pad2(total % 60)}`
}

/** 日期选择器的可读标题，例如 "今天 · 10月5日 周日"。 */
export function fmtDateLabel(dateISO: string, todayISO: string): string {
  const date = new Date(startOfDay(dateISO))
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()]
  const stamp = `${date.getMonth() + 1}月${date.getDate()}日 ${weekday}`
  return dateISO === todayISO ? `今天 · ${stamp}` : stamp
}
