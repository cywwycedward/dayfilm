import { BUILTIN_REDACT_TERMS, REDACTED_TITLE } from '../../shared/settings'
import type { Sample } from '../../shared/types'

/** 与 docs/data/store-format.md 一致的标题上限。 */
const MAX_TITLE = 512

/** 标题或进程名命中任一关键词（不区分大小写）就隐藏标题，进程名保留（规格 R10.1）。 */
export function redactSample(sample: Sample, terms: readonly string[] = []): Sample {
  const title = sample.title.slice(0, MAX_TITLE)
  if (matches(title, sample.exe, terms)) return { ...sample, title: REDACTED_TITLE }
  return { ...sample, title }
}

function matches(title: string, exe: string, terms: readonly string[]): boolean {
  const haystack = `${title}\n${exe}`.toLowerCase()
  for (const term of BUILTIN_REDACT_TERMS) {
    if (haystack.includes(term)) return true
  }
  for (const term of terms) {
    const needle = term.trim().toLowerCase()
    if (needle.length > 0 && haystack.includes(needle)) return true
  }
  return false
}
