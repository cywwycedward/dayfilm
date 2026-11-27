// 监督用：把组件截图拼成一张对照图（带标题），方便一次贴给外部评审。
// 用法：node scripts/make-contact-sheet.cjs <输出png> <输入1> <输入2> ...
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

const [out, ...inputs] = process.argv.slice(2)
if (!out || inputs.length === 0) {
  console.error('usage: node scripts/make-contact-sheet.cjs <out.png> <in1.png> [in2.png ...]')
  process.exit(1)
}

const ps = `
Add-Type -AssemblyName System.Drawing
$out = '${out.replace(/'/g, "''")}'
$inputs = @(${inputs.map((p) => `'${p.replace(/'/g, "''")}'`).join(', ')})
$width = 1400
$pad = 20
$font = New-Object System.Drawing.Font('Consolas', 13)
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(232,180,90))
$bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(10,11,13))
$items = @()
foreach ($i in $inputs) {
  $img = [System.Drawing.Image]::FromFile($i)
  $scale = [Math]::Min(1.0, ($width - 2 * $pad) / $img.Width)
  $items += [pscustomobject]@{ img = $img; w = [int]($img.Width * $scale); h = [int]($img.Height * $scale); name = [System.IO.Path]::GetFileNameWithoutExtension($i) }
}
$total = 0
foreach ($it in $items) { $total += 22 + $it.h + $pad }
$bmp = New-Object System.Drawing.Bitmap($width, [int]$total)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.Clear([System.Drawing.Color]::FromArgb(10,11,13))
$y = 0
foreach ($it in $items) {
  $g.DrawString($it.name, $font, $brush, $pad, $y)
  $y += 22
  $g.DrawImage($it.img, $pad, $y, $it.w, $it.h)
  $y += $it.h + $pad
}
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "saved $out"
`

execFileSync(
  'powershell',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
  { stdio: 'inherit', cwd: join(__dirname, '..') }
)
