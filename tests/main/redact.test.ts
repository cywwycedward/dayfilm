import { describe, expect, it } from 'vitest'
import { BUILTIN_REDACT_TERMS, REDACTED_TITLE } from '../../src/shared/settings'
import { redactSample } from '../../src/main/redact'
import type { Sample } from '../../src/shared/types'

const BASE: Sample = { t: 1_765_000_000_000, exe: 'Code', title: 'dayfilm - Visual Studio Code', idleMs: 1200 }

function sample(patch: Partial<Sample>): Sample {
  return { ...BASE, ...patch }
}

describe('redactSample', () => {
  it('内置词命中时隐藏标题、保留进程名', () => {
    const redacted = redactSample(sample({ title: 'vault - 1Password', exe: 'Chrome' }), [])
    expect(redacted.title).toBe(REDACTED_TITLE)
    expect(redacted.exe).toBe('Chrome')
    expect(redacted.t).toBe(BASE.t)
    expect(redacted.idleMs).toBe(BASE.idleMs)
  })

  it('内置词覆盖密码管理器、隐私浏览、银行与支付', () => {
    for (const term of BUILTIN_REDACT_TERMS) {
      expect(redactSample(sample({ title: `窗口 ${term}` }), []).title, term).toBe(REDACTED_TITLE)
    }
  })

  it('自定义词不区分大小写，命中标题', () => {
    expect(redactSample(sample({ title: 'ACME Payroll - 结算' }), ['acme']).title).toBe(REDACTED_TITLE)
    expect(redactSample(sample({ title: 'acme payroll' }), ['ACME']).title).toBe(REDACTED_TITLE)
  })

  it('进程名命中同样隐藏标题', () => {
    expect(redactSample(sample({ exe: 'Bitwarden' }), []).title).toBe(REDACTED_TITLE)
    expect(redactSample(sample({ exe: 'notion', title: '工作区' }), ['NOTION']).title).toBe(REDACTED_TITLE)
  })

  it('中文关键词命中', () => {
    expect(redactSample(sample({ title: '中国银行 - 个人网银' }), []).title).toBe(REDACTED_TITLE)
    expect(redactSample(sample({ title: '私密笔记' }), ['私密']).title).toBe(REDACTED_TITLE)
  })

  it('没有命中时保留原文', () => {
    const kept = redactSample(sample({ title: 'dayfilm - Visual Studio Code' }), ['payroll'])
    expect(kept.title).toBe('dayfilm - Visual Studio Code')
  })

  it('先截断再匹配：截断后仍含关键词才隐藏', () => {
    const long = 'x'.repeat(600)
    expect(redactSample(sample({ title: long }), []).title).toHaveLength(512)
    // 关键词在第 512 之后会被截掉，不会落盘，因此也不需要隐藏
    expect(redactSample(sample({ title: `${long} bank` }), []).title).toHaveLength(512)
    // 关键词在截断范围内则隐藏
    expect(redactSample(sample({ title: `bank ${long}` }), []).title).toBe(REDACTED_TITLE)
  })

  it('空关键词与空白关键词不命中', () => {
    expect(redactSample(sample({ title: 'normal' }), ['', '   ']).title).toBe('normal')
  })
})
