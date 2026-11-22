// 打包产物自检：node scripts/pack/verify.cjs [解包目录，默认 dist/win-unpacked]
// 断言 exe、app.asar、capture.ps1 就位，且 asar 里没有源码、测试与 sourcemap。输出 JSON，失败退出码 1。
const { existsSync, statSync } = require('node:fs')
const { dirname, join, resolve } = require('node:path')
const asar = require('@electron/asar')

const dir = resolve(process.argv[2] || join(__dirname, '..', '..', 'dist', 'win-unpacked'))
const checks = []

function sizeOf(path) {
  return existsSync(path) ? statSync(path).size : null
}

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), ...detail })
  return Boolean(ok)
}

async function main() {
  const exe = join(dir, 'Dayfilm.exe')
  check('exe', existsSync(exe), { path: exe, bytes: sizeOf(exe) })

  const resources = join(dir, 'resources')

  // resourcesPath 根下的 runtime 资源：必须存在、非空、且不在子目录里。
  const rootAsset = (name, checkName) => {
    const path = join(resources, name)
    const atRoot = dirname(path) === resources
    return check(checkName, atRoot && existsSync(path) && statSync(path).size > 0, {
      path,
      bytes: sizeOf(path),
      atResourcesRoot: atRoot
    })
  }

  const asarPath = join(resources, 'app.asar')
  const hasAsar = check('asar', existsSync(asarPath), { path: asarPath, bytes: sizeOf(asarPath) })

  // 主进程分别按 resourcesPath/capture.ps1 与 resourcesPath/tray.png 取这两个文件。
  rootAsset('capture.ps1', 'captureScript')
  rootAsset('tray.png', 'trayIcon')

  let entries = []
  let listError = null
  if (hasAsar) {
    try {
      // Windows 上 listPackage 返回 \out\main\index.js 这种反斜杠路径。
      entries = (await asar.listPackage(asarPath)).map((p) => p.replace(/\\/g, '/').replace(/^\/+/, ''))
    } catch (err) {
      listError = String(err && err.message ? err.message : err)
    }
  }
  const hits = (re) => entries.filter((p) => re.test(p))
  const src = hits(/(^|\/)src\//)
  const tests = hits(/(^|\/)tests?\//)
  const maps = hits(/\.map$/)
  check('asarContents', hasAsar && !listError && !src.length && !tests.length && !maps.length, {
    entries: entries.length,
    error: listError,
    src: src.slice(0, 5),
    tests: tests.slice(0, 5),
    maps: maps.slice(0, 5)
  })

  // 只有一个空 asar 时上面几条都会通过，所以再确认入口文件在包里。
  check('asarEntry', entries.includes('out/main/index.js') && entries.includes('package.json'), {
    main: entries.includes('out/main/index.js'),
    packageJson: entries.includes('package.json')
  })

  const ok = checks.every((c) => c.ok)
  console.log(JSON.stringify({ ok, unpackDir: dir, checks }, null, 2))
  return ok
}

main().then(
  (ok) => process.exit(ok ? 0 : 1),
  (err) => {
    console.log(JSON.stringify({ ok: false, unpackDir: dir, error: String(err && err.stack ? err.stack : err) }, null, 2))
    process.exit(1)
  }
)
