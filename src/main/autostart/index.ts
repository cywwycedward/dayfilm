export interface LoginItemOptions {
  openAtLogin: boolean
  path: string
  args: string[]
}

/**
 * 开机自启写哪个可执行文件（规格 R12.3）。
 * portable 目标运行时 `process.execPath` 是 NSIS 解到 %TEMP% 的副本，下次登录可能已被清理；
 * electron-builder 会把用户真正双击的那个 exe 放进 `PORTABLE_EXECUTABLE_FILE`。
 */
export function loginItemSettings(
  openAtLogin: boolean,
  env: NodeJS.ProcessEnv,
  execPath: string
): LoginItemOptions {
  const portable = env.PORTABLE_EXECUTABLE_FILE
  const path = typeof portable === 'string' && portable.length > 0 ? portable : execPath
  return { openAtLogin, path, args: ['--hidden'] }
}
