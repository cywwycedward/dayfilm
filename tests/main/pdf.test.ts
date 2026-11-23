import { describe, expect, it } from 'vitest'
import { ensureExtension } from '../../src/main/export'
import { MIN_PDF_BYTES, buildScriptHtml, escapeHtml, isEmptyPdf } from '../../src/main/pdf'
import type { DayRollup, Scene } from '../../src/shared/types'

const DATE = '2026-11-22'
const T0 = new Date(2026, 10, 22, 9, 0, 0).getTime()

function shot(startMs: number, endMs: number, exe = 'Code', title = 'dayfilm - Visual Studio Code'): Scene {
  return {
    id: `${DATE}-${startMs}`,
    start: T0 + startMs,
    end: T0 + endMs,
    exe,
    title,
    seconds: Math.round((endMs - startMs) / 1000),
    kind: 'shot'
  }
}

function day(scenes: Scene[], patch: Partial<Omit<DayRollup, 'featureMs' | 'extraMs'>> = {}): DayRollup {
  return {
    date: DATE,
    firstAt: T0,
    lastAt: T0 + 600_000,
    activeMs: 600_000,
    idleMs: 0,
    scenes,
    cuts: 3,
    longestShot: null,
    topApps: [],
    verdict: { label: '标准剪辑', note: '最长的一个镜头是 Code 的 10 分钟。', cutRate: 4 },
    featureMs: 600_000,
    extraMs: 0,
    ...patch
  }
}

describe('escapeHtml', () => {
  it('转义 < > & " \'', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(escapeHtml('a & b')).toBe('a &amp; b')
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;')
    expect(escapeHtml("it's")).toBe('it&#39;s')
  })

  it('先转 & 再转其余，不会二次转义', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })
})

describe('buildScriptHtml', () => {
  it('自包含：没有外部资源引用', () => {
    const html = buildScriptHtml(day([shot(0, 600_000)]))
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<style>')
    expect(html).not.toContain('<link')
    expect(html).not.toContain('<script')
    expect(html).not.toMatch(/https?:\/\//)
  })

  it('分节顺序：标题 → 手记 → 题材 → 三项数字 → 项目 → 镜头表', () => {
    const html = buildScriptHtml(day([shot(0, 600_000)]), {
      note: '今天收尾不错',
      projects: [{ name: '编码', terms: ['code'] }]
    })
    const title = html.indexOf(`${DATE} · Dayfilm 剧本`)
    const note = html.indexOf('导演手记：今天收尾不错')
    const genre = html.indexOf('题材')
    const stats = html.indexOf('活跃时长')
    const projects = html.indexOf('项目')
    const table = html.indexOf('<table>')
    expect(title).toBeGreaterThan(-1)
    expect(title).toBeLessThan(note)
    expect(note).toBeLessThan(genre)
    expect(genre).toBeLessThan(stats)
    expect(stats).toBeLessThan(projects)
    expect(projects).toBeLessThan(table)
  })

  it('没有手记、没有项目时不出现对应分节', () => {
    const html = buildScriptHtml(day([shot(0, 600_000)]))
    expect(html).not.toContain('导演手记')
    expect(html).not.toContain('>项目<')
  })

  it('三项数字取活跃时长、镜头数、剪辑数', () => {
    const html = buildScriptHtml(day([shot(0, 600_000), shot(600_000, 1_200_000, 'Slack', '#general')]))
    expect(html).toContain('活跃时长')
    expect(html).toContain('10 分钟')
    expect(html).toContain('<b>2</b>')
    expect(html).toContain('<b>3</b>')
  })

  it('项目只取前 3', () => {
    const scenes = [
      shot(0, 240_000, 'figma', 'design'),
      shot(240_000, 420_000, 'chrome', 'GitHub'),
      shot(420_000, 540_000, 'Slack', '#general'),
      shot(540_000, 600_000, 'Code', 'dayfilm')
    ]
    const html = buildScriptHtml(day(scenes), {
      projects: [
        { name: '设计', terms: ['figma'] },
        { name: '其他', terms: ['chrome'] },
        { name: '沟通', terms: ['slack'] },
        { name: '编码', terms: ['code'] }
      ]
    })
    expect(html).toContain('设计 4 分钟 · 其他 3 分钟 · 沟通 2 分钟')
    expect(html).not.toContain('编码 1 分钟')
  })

  it('镜头表只列非空闲镜头，行数与时间格式正确', () => {
    const intermission: Scene = {
      id: `${DATE}-i`,
      start: T0 + 300_000,
      end: T0 + 420_000,
      exe: '',
      title: '',
      seconds: 120,
      kind: 'intermission'
    }
    const html = buildScriptHtml(day([shot(0, 120_000), intermission, shot(420_000, 600_000, 'Slack', '#general')]))
    const rows = html.match(/<tr><td class="num mark-/g) ?? []
    expect(rows).toHaveLength(2)
    expect(html).toContain('<td class="num">09:00–09:02</td><td>Code</td><td>dayfilm - Visual Studio Code</td><td class="num">2m</td>')
    expect(html).toContain('<td class="num">09:07–09:10</td><td>Slack</td><td>#general</td><td class="num">3m</td>')
    expect(html).toContain('时间区间')
    expect(html).toContain('应用')
    expect(html).toContain('标题')
    expect(html).toContain('时长')
  })

  it('每 25 行分一组 tbody，表头靠 thead 重复', () => {
    const scenes = Array.from({ length: 30 }, (_, index) => shot(index * 60_000, index * 60_000 + 30_000, 'Code', `w${index}`))
    const html = buildScriptHtml(day(scenes))
    expect(html.match(/<tbody>/g) ?? []).toHaveLength(2)
    expect(html.match(/<thead>/g) ?? []).toHaveLength(1)
    expect(html).toContain('display: table-header-group')
  })

  it('没有镜头时不出表格', () => {
    const html = buildScriptHtml(day([]))
    expect(html).not.toContain('<table>')
  })

  it('所有插值都转义：标题、进程名、手记、项目名', () => {
    const html = buildScriptHtml(day([shot(0, 600_000, '<img src=x onerror=alert(1)>', '<script>alert("x")</script>')]), {
      note: '<b>粗体</b> & "引号"',
      projects: [{ name: '<i>项目</i>', terms: ['script'] }]
    })
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('<b>粗体</b>')
    expect(html).not.toContain('<i>项目</i>')
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
    expect(html).toContain('&lt;b&gt;粗体&lt;/b&gt; &amp; &quot;引号&quot;')
    expect(html).toContain('&lt;i&gt;项目&lt;/i&gt;')
  })

  it('空标题在表格里写占位文案', () => {
    const html = buildScriptHtml(day([shot(0, 600_000, 'Code', '   ')]))
    expect(html).toContain('<td>未命名窗口</td>')
  })
})

describe('PDF 扩展名', () => {
  it('强制 .pdf', () => {
    expect(ensureExtension('C:\\out\\dayfilm-2026-11-22.txt', 'pdf')).toBe('C:\\out\\dayfilm-2026-11-22.pdf')
    expect(ensureExtension('C:\\out\\dayfilm-2026-11-22.PDF', 'pdf')).toBe('C:\\out\\dayfilm-2026-11-22.PDF')
    expect(ensureExtension('C:\\out\\dayfilm-2026-11-22', 'pdf')).toBe('C:\\out\\dayfilm-2026-11-22.pdf')
  })
})

describe('isEmptyPdf', () => {
  it('小于 2000 字节判为“白纸”', () => {
    expect(isEmptyPdf({ length: 0 })).toBe(true)
    expect(isEmptyPdf({ length: MIN_PDF_BYTES - 1 })).toBe(true)
  })

  it('刚好到阈值与真实体量都不算空', () => {
    expect(isEmptyPdf({ length: MIN_PDF_BYTES })).toBe(false)
    expect(isEmptyPdf({ length: 106 * 1024 })).toBe(false)
  })

  it('Buffer / Uint8Array 都能直接用', () => {
    expect(isEmptyPdf(Buffer.alloc(0))).toBe(true)
    expect(isEmptyPdf(Buffer.alloc(MIN_PDF_BYTES + 1))).toBe(false)
    expect(isEmptyPdf(new Uint8Array(MIN_PDF_BYTES - 1))).toBe(true)
  })
})

describe('PDF 导演剪辑版（v2.4）', () => {
  it('汇总有正片/花絮，表格首列是标记', () => {
    const scenes = [{ ...shot(0, 600_000), mark: 'extra' as const }, shot(600_000, 1_200_000, 'Slack', '#general')]
    const base = day(scenes)
    const html = buildScriptHtml({ ...base, featureMs: 600_000, extraMs: 600_000 })

    expect(html).toContain('正片 10 分钟 · 花絮 10 分钟')
    expect(html).toContain('<th>标记</th>')
    expect(html).toContain('<td class="num mark-extra">花絮</td>')
    // 未标记按正片算（与 featureMs 口径一致）
    expect(html).toContain('<td class="num mark-feature">正片</td>')
  })

  it('没有花絮时汇总写 0 分钟', () => {
    const html = buildScriptHtml(day([shot(0, 600_000)]))
    expect(html).toContain('正片 10 分钟 · 花絮 0 分钟')
  })

  it('自动花絮在标记列写「花絮（自动）」', () => {
    const autoScenes = [{ ...shot(0, 600_000), mark: 'extra' as const, markSource: 'auto' as const }, shot(600_000, 1_200_000)]
    const html = buildScriptHtml(day(autoScenes))
    expect(html).toContain('<td class="num mark-extra">花絮（自动）</td>')

    const manual = buildScriptHtml(day([{ ...shot(0, 600_000), mark: 'extra' as const, markSource: 'manual' as const }]))
    expect(manual).toContain('<td class="num mark-extra">花絮</td>')
    expect(manual).not.toContain('花絮（自动）')
  })
})
