/**
 * 日期跟随：界面该不该跟着跨零点切到新的一天。
 * 纯函数：不读时钟、不读状态，输入就是判断所需的全部信息。
 */

export interface DateFollowInput {
  /** 界面当前展示的日期 YYYY-MM-DD */
  current: string
  /** 今天的本地日期 */
  today: string
  /** 用户是否主动在翻历史（是则一律不打断） */
  browsingHistory: boolean
  /** 实时状态里的日期，即主进程正在写的日文件 */
  liveDate: string
  /** 主进程返回的日期列表 */
  knownDates: readonly string[]
  /** 已经为哪一天补拉过日期列表，避免同一天反复刷新 */
  refreshedFor: string | null
}

export interface DateFollowResult {
  /** 需要切到的日期；null 表示保持当前视图 */
  nextDate: string | null
  /** 是否需要重新拉一次 listDays() */
  refreshDates: boolean
}

export function followDate(input: DateFollowInput): DateFollowResult {
  // 下拉框缺这一天，且这一天还没补拉过
  const stale = (date: string): boolean =>
    !input.knownDates.includes(date) && input.refreshedFor !== date

  if (input.browsingHistory) {
    // 用户主动在看历史：不换视图，只把下拉框补新
    return { nextDate: null, refreshDates: stale(input.liveDate) }
  }

  if (input.current !== input.liveDate) {
    // 过零点了。只在实时日期确实就是今天时跟随，异常时钟不会把界面带走
    if (input.liveDate === input.today) {
      return { nextDate: input.liveDate, refreshDates: true }
    }
    return { nextDate: null, refreshDates: false }
  }

  // 已经停在这一天：只补一次日期列表（例如启动时今天还没有日文件）
  return { nextDate: null, refreshDates: stale(input.liveDate) }
}
