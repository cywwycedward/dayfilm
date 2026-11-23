/**
 * 片场日历（R52）：12 周 × 7 天的格子与色阶。纯函数，缺数据的天按 0 处理。
 * 最后一行是本周，周一是行首；今天之后的天标 future，由界面留白。
 */
import { isoDate, startOfDay } from './time'

export const CALENDAR_DAYS = 84
const WEEKS = 12
/** 色阶：18%–82% 的暖白，按活跃时长平方根映射 */
const LEVEL_MIN = 0.18
const LEVEL_SPAN = 0.64

export interface CalendarDay {
  date: string
  activeMs: number
  genre: string
  shots: number
}

export interface CalendarCell {
  date: string
  /** 周一 = 0 … 周日 = 6 */
  dow: number
  /** 0 = 没有采样（画 2px 暗格）；>0 是 18%–82% 的暖白强度 */
  level: number
  /** 题材色相：无记录 0/0/8，长镜头 200/35/55，标准剪辑 45/8/58，快切 48/38/68，跳切风暴 30/62/82 */
  hue: number
  sat: number
  lum: number
  activeMs: number
  genre: string
  shots: number
  /** 今天之后的格子 */
  future: boolean
}

/** 日历覆盖的 84 天，从 11 周前的周一排到本周的周日。 */
export function calendarDates(today: string): string[] {
  const base = new Date(startOfDay(today))
  const dow = (base.getDay() + 6) % 7
  const first = new Date(base)
  first.setDate(first.getDate() - dow - (WEEKS - 1) * 7)
  const dates: string[] = []
  for (let index = 0; index < CALENDAR_DAYS; index += 1) {
    const date = new Date(first)
    date.setDate(date.getDate() + index)
    dates.push(isoDate(date.getTime()))
  }
  return dates
}

export interface GenrePalette {
  hue: number
  sat: number
  lum: number
}

/** 题材 → 色相（ui-concept-v4 B 块）；未列出的题材按“标准剪辑”处理。 */
export const GENRE_PALETTE: Readonly<Record<string, GenrePalette>> = {
  '长镜头': { hue: 200, sat: 35, lum: 55 },
  '标准剪辑': { hue: 45, sat: 8, lum: 58 },
  '快切': { hue: 48, sat: 38, lum: 68 },
  '跳切风暴': { hue: 30, sat: 62, lum: 82 }
}
export const NO_RECORD_PALETTE: GenrePalette = { hue: 0, sat: 0, lum: 8 }

/** 题材与活跃度 → 格子颜色：亮度在题材基色上微调（±6）。 */
export function cellPalette(genre: string, level: number): GenrePalette {
  if (genre.length === 0) return NO_RECORD_PALETTE
  const base = GENRE_PALETTE[genre] ?? GENRE_PALETTE['标准剪辑']
  const lum = Math.round(Math.min(92, Math.max(8, base.lum - 6 + level * 12)))
  return { hue: base.hue, sat: base.sat, lum }
}

export function calendarCells(
  days: ReadonlyMap<string, CalendarDay>,
  today: string
): CalendarCell[] {
  const dates = calendarDates(today)
  let peak = 0
  for (const date of dates) {
    const activeMs = days.get(date)?.activeMs ?? 0
    if (activeMs > peak) peak = activeMs
  }
  return dates.map((date, index) => {
    const day = days.get(date)
    const activeMs = day?.activeMs ?? 0
    const level = peak > 0 && activeMs > 0 ? LEVEL_MIN + LEVEL_SPAN * Math.sqrt(activeMs / peak) : 0
    const genre = day?.genre ?? ''
    const palette = cellPalette(genre, level)
    return {
      date,
      dow: index % 7,
      level,
      hue: palette.hue,
      sat: palette.sat,
      lum: palette.lum,
      activeMs,
      genre,
      shots: day?.shots ?? 0,
      future: date > today
    }
  })
}
