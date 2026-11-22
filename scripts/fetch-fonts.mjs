// 下载三套字体（woff2，latin 子集）+ OFL 授权，放到渲染层 assets 里。
// 用法: node scripts/fetch-fonts.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'src', 'renderer', 'src', 'assets', 'fonts')
mkdirSync(out, { recursive: true })

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const families = [
  { css: 'Inter:wght@400;500;600;700', prefix: 'inter' },
  { css: 'IBM+Plex+Mono:wght@400;500', prefix: 'plex-mono' },
  { css: 'Bebas+Neue', prefix: 'bebas' }
]

const saved = []
for (const family of families) {
  const url = `https://fonts.googleapis.com/css2?family=${family.css}&display=swap`
  const css = await (await fetch(url, { headers: { 'user-agent': UA } })).text()
  const blocks = css.split('@font-face').slice(1)
  let index = 0
  for (const block of blocks) {
    const subset = /\/\* ([a-z-]+) \*\//.exec(block)
    if (subset && subset[1] !== 'latin') continue
    const weight = /font-weight:\s*(\d+)/.exec(block)?.[1] ?? '400'
    const src = /url\((https:[^)]+\.woff2)\)/.exec(block)?.[1]
    if (!src) continue
    index += 1
    const name = `${family.prefix}-${weight}.woff2`
    const buf = Buffer.from(await (await fetch(src, { headers: { 'user-agent': UA } })).arrayBuffer())
    writeFileSync(join(out, name), buf)
    saved.push({ file: name, bytes: buf.length, weight })
  }
  if (index === 0) console.warn('no latin faces for', family.prefix)
}

const license = `本目录字体来自 Google Fonts，依 SIL Open Font License 1.1 分发。

- Inter — Copyright (c) 2016 The Inter Project Authors — https://github.com/rsms/inter
- IBM Plex Mono — Copyright (c) 2017 IBM Corp. — https://github.com/IBM/plex
- Bebas Neue — Copyright (c) 2010 Dharma Type — https://github.com/dharmatype/Bebas-Neue

OFL 全文: https://openfontlicense.org/open-font-license-official-text/
`
writeFileSync(join(out, 'OFL.txt'), license, 'utf8')
console.log(JSON.stringify(saved, null, 2))
