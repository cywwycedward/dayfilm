import { totalByProject } from '../../shared/projects'
import type { ProjectRule } from '../../shared/settings'
import type { DayRollup, Scene } from '../../shared/types'
import { minutesAtLeastOne } from '../reel/rules'

export interface ScriptHtmlOptions {
  /** 当天导演手记，有内容时排在标题下面（规格 R53.2） */
  note?: string
  /** 项目规则，有命中时插一行项目时长（前 3） */
  projects?: readonly ProjectRule[]
  /** 主题：目前只有经典（近黑底暖白字）；参数留着以后扩 */
  theme?: 'classic'
}

const PROJECT_LINES = 3
/** 表格每 25 行一组，让分页有明确的切点（表头靠 thead 重复）。 */
const ROWS_PER_BLOCK = 25

/** HTML 转义：标题、进程名、手记、项目名都要过一遍，防止注入（规格 R53.4）。 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function clock(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function duration(ms: number): string {
  return `${minutesAtLeastOne(ms)}m`
}

function span(ms: number): string {
  const total = ms > 0 ? minutesAtLeastOne(ms) : 0
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return hours > 0 ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`
}

function sceneRows(scenes: readonly Scene[]): string[][] {
  return scenes
    .filter((scene) => scene.kind === 'shot')
    .map((scene) => [
      `${clock(scene.start)}–${clock(scene.end)}`,
      scene.exe,
      scene.title.trim().length > 0 ? scene.title : '未命名窗口',
      duration(scene.end - scene.start)
    ])
}

function tableRow(cells: readonly string[]): string {
  const [range, exe, title, length] = cells.map(escapeHtml)
  return `<tr><td class="num">${range}</td><td>${exe}</td><td>${title}</td><td class="num">${length}</td></tr>`
}

function sceneTable(scenes: readonly Scene[]): string {
  const rows = sceneRows(scenes)
  if (rows.length === 0) return ''
  const blocks: string[] = []
  for (let index = 0; index < rows.length; index += ROWS_PER_BLOCK) {
    const chunk = rows.slice(index, index + ROWS_PER_BLOCK).map(tableRow).join('')
    blocks.push(`<tbody>${chunk}</tbody>`)
  }
  return [
    '<table>',
    '<thead><tr><th>时间区间</th><th>应用</th><th>标题</th><th>时长</th></tr></thead>',
    ...blocks,
    '</table>'
  ].join('')
}

function stat(label: string, value: string): string {
  return `<div class="stat"><span class="eyebrow">${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`
}

const STYLE = `
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  /* 背景必须落在 html 上：页面画布看 html，只画 body 时打印出来的“纸”仍是白的。 */
  html, body {
    margin: 0;
    background: #0d0f12;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body {
    color: #f2ecdf;
    font: 11px/1.6 Inter, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  }
  .sheet { padding: 0; }
  .eyebrow {
    font: 10px/1.2 ui-monospace, "Cascadia Mono", "Consolas", monospace;
    letter-spacing: .18em;
    text-transform: uppercase;
    color: #8d867a;
  }
  h1 { margin: 8px 0 0; font-size: 28px; line-height: 1.15; font-weight: 700; letter-spacing: -.01em; }
  .note {
    margin: 16px 0 0;
    padding: 4px 0 4px 10px;
    border-left: 2px solid #c9a227;
    color: #ece3d1;
    font-size: 11px;
  }
  .section { margin-top: 18px; }
  .verdict { margin: 6px 0 0; font-size: 13px; }
  .verdict .label { color: #f4c76a; }
  .stats { display: flex; gap: 8px; margin-top: 16px; }
  .stat { flex: 1; border: 1px solid #24282f; padding: 8px 10px; }
  .stat b { display: block; margin-top: 4px; font: 18px/1.2 ui-monospace, "Cascadia Mono", monospace; }
  .projects { margin: 6px 0 0; color: #d8d1c2; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; font: 10px/1.45 ui-monospace, "Cascadia Mono", monospace; }
  thead { display: table-header-group; }
  tbody { break-inside: auto; }
  tr { break-inside: avoid; }
  th {
    text-align: left;
    padding: 5px 6px;
    color: #8d867a;
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: .12em;
    border-bottom: 1px solid #2b3038;
  }
  td { padding: 5px 6px; border-bottom: 1px solid #1d2126; vertical-align: top; }
  td.num { white-space: nowrap; color: #cfc7b6; }
`

/** 导出 PDF 的最小合理体积：比这小几乎肯定是一张白纸（规格 R53.5）。 */
export const MIN_PDF_BYTES = 2000

/** 打印结果小到不可信时判为失败，不静默写出一张白纸。 */
export function isEmptyPdf(bytes: { length: number }): boolean {
  return bytes.length < MIN_PDF_BYTES
}

/**
 * 剧本 PDF 的 HTML（规格 R53）。纯函数、自包含：所有插值都转义，不引用任何外部资源，
 * 用隐藏窗口 `printToPDF` 渲染即可（`pdf/render.ts`）。
 */
export function buildScriptHtml(day: DayRollup, options: ScriptHtmlOptions = {}): string {
  const parts: string[] = []
  parts.push(`<div class="eyebrow">Dayfilm 剧本</div>`)
  parts.push(`<h1>${escapeHtml(day.date)} · Dayfilm 剧本</h1>`)

  const note = options.note?.trim() ?? ''
  if (note.length > 0) {
    parts.push(`<p class="note">导演手记：${escapeHtml(note)}</p>`)
  }

  parts.push(
    `<div class="section"><div class="eyebrow">题材</div>` +
      `<p class="verdict"><span class="label">${escapeHtml(day.verdict.label)}</span> ${escapeHtml(day.verdict.note)}</p></div>`
  )

  const shotCount = day.scenes.filter((scene) => scene.kind === 'shot').length
  parts.push(
    `<div class="stats">${stat('活跃时长', span(day.activeMs))}${stat('镜头', `${shotCount}`)}${stat('剪辑', `${day.cuts}`)}</div>`
  )

  const projects = options.projects && options.projects.length > 0 ? totalByProject(day.scenes, options.projects) : []
  if (projects.length > 0) {
    const text = projects
      .slice(0, PROJECT_LINES)
      .map((project) => `${project.name} ${minutesAtLeastOne(project.ms)} 分钟`)
      .join(' · ')
    parts.push(`<div class="section"><div class="eyebrow">项目</div><p class="projects">${escapeHtml(text)}</p></div>`)
  }

  const table = sceneTable(day.scenes)
  if (table.length > 0) parts.push(`<div class="section">${table}</div>`)

  return [
    '<!doctype html>',
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    `<title>${escapeHtml(day.date)} · Dayfilm 剧本</title>`,
    `<style>${STYLE}</style>`,
    '</head><body>',
    `<div class="sheet">${parts.join('')}</div>`,
    '</body></html>'
  ].join('')
}
