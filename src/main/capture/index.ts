import { spawn, type ChildProcess } from 'node:child_process'
import type { Sample } from '../../shared/types'
import { resolveResource } from '../resources'

/** 采样间隔的估算值：一条采样代表它之后这 2 秒仍在同一窗口。 */
const MAX_TITLE = 512
/** 子进程存活超过这个时长后才重置重启计数，防止"启动即崩溃"无限循环。 */
const STABLE_MS = 60_000
/** 重试用完后放弃，只保留 captureError。 */
const RESTART_DELAYS_MS = [1000, 3000, 9000]
/** 缓存超过这个长度的半行视为异常输出，丢弃以免内存无限增长。 */
const MAX_BUFFER = 1_000_000

export interface CaptureStatus {
  capturing: boolean
  error: string | null
}

export interface CapturePaths {
  isPackaged: boolean
  appPath: string
  resourcesPath: string
}

export interface CaptureDeps {
  /** capture.ps1 的绝对路径 */
  script: string
  onSample(sample: Sample): void
  onStatus(status: CaptureStatus): void
  /** 可注入的 spawn，测试用；默认真实子进程 */
  spawnChild?(command: string, args: string[]): ChildProcess
  /** 结束采集进程树，测试用；默认 Windows 用 taskkill /T /F，其余平台 child.kill() */
  killTree?(pid: number, child: ChildProcess): void
  /** 可注入的时钟与定时器，测试用 */
  now?(): number
  schedule?(fn: () => void, ms: number): () => void
}

export interface Capture {
  start(): void
  stop(): void
}

/** 打包后脚本位于 process.resourcesPath，开发时留在仓库的 resources 目录。 */
export function resolveCaptureScript(paths: CapturePaths): string {
  return resolveResource('capture.ps1', paths)
}

/** 把 stdout 的任意分块切成完整行，半行留到下一块；返回喂数据用的函数。 */
export function createLineSplitter(onLine: (line: string) => void): (chunk: string) => void {
  let buffer = ''
  return (chunk) => {
    buffer += chunk
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, '')
      buffer = buffer.slice(index + 1)
      if (line.trim().length > 0) onLine(line)
      index = buffer.indexOf('\n')
    }
    if (buffer.length > MAX_BUFFER) buffer = ''
  }
}

export interface ParsedLine {
  sample: Sample | null
  error: string | null
}

/**
 * 解析脚本输出的一行。采样时刻由主进程在收到行时打点（脚本只给窗口事实），
 * 标题超过 512 字符截断，与 docs/data/store-format.md 一致。
 */
export function parseCaptureLine(line: string, now: number): ParsedLine {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return { sample: null, error: '采样输出不是合法 JSON' }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { sample: null, error: '采样输出不是 JSON 对象' }
  }
  const record = value as Record<string, unknown>
  if (record.ok !== true) {
    const reason = typeof record.error === 'string' && record.error.length > 0 ? record.error : '采集失败'
    return { sample: null, error: reason }
  }
  const { exe, title, idleMs } = record
  if (typeof exe !== 'string' || typeof title !== 'string' || typeof idleMs !== 'number' || !Number.isFinite(idleMs)) {
    return { sample: null, error: '采样字段缺失或类型不符' }
  }
  return {
    sample: { t: now, exe, title: title.slice(0, MAX_TITLE), idleMs: Math.max(0, Math.round(idleMs)) },
    error: null
  }
}

function defaultSpawn(command: string, args: string[]): ChildProcess {
  return spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
}

function defaultSchedule(fn: () => void, ms: number): () => void {
  const timer = setTimeout(fn, ms)
  return () => clearTimeout(timer)
}

/** 拉起脚本的参数。`-ParentPid` 让脚本在宿主消失后自行退出，不留孤儿。 */
export function captureArgs(script: string, parentPid: number): string[] {
  return ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-ParentPid', String(parentPid)]
}

/** `/T` 连子进程一起结束，`/F` 强制。 */
export function taskkillArgs(pid: number): string[] {
  return ['/PID', String(pid), '/T', '/F']
}

function spawnKiller(command: string, args: string[]): ChildProcess {
  return spawn(command, args, { stdio: 'ignore', windowsHide: true })
}

/**
 * 结束采集子进程。Windows 用 taskkill 整树收掉（PowerShell 可能派生 csc.exe 等）；
 * taskkill 本身失败（进程已退出、无权限）时退回直接 kill，不让采集进程活着没人管。
 */
export function killProcessTree(pid: number, child: ChildProcess, spawnProcess = spawnKiller): void {
  if (process.platform !== 'win32') {
    child.kill()
    return
  }
  const killer = spawnProcess('taskkill', taskkillArgs(pid))
  killer.on('error', () => child.kill())
  killer.on('exit', (code: number | null) => {
    if (code !== 0) child.kill()
  })
}

/**
 * 常驻采集进程的监督者：拉起脚本、逐行解析、退出后按 1s/3s/9s 退避重启。
 * 只依赖 node 子进程，不引用 Electron，便于直接测试。
 */
export function createCapture(deps: CaptureDeps): Capture {
  const spawnChild = deps.spawnChild ?? defaultSpawn
  const killTree = deps.killTree ?? killProcessTree
  const schedule = deps.schedule ?? defaultSchedule
  const now = deps.now ?? Date.now

  let child: ChildProcess | null = null
  let cancelRestart: (() => void) | null = null
  let restarts = 0
  let launchedAt = 0
  let running = false
  let parseErrors = 0
  let stderrTail = ''
  let status: CaptureStatus = { capturing: false, error: null }

  function setStatus(next: CaptureStatus): void {
    if (next.capturing === status.capturing && next.error === status.error) return
    status = next
    deps.onStatus(next)
  }

  function launch(): void {
    parseErrors = 0
    stderrTail = ''
    launchedAt = now()
    const proc = spawnChild('powershell.exe', captureArgs(deps.script, process.pid))
    child = proc

    const splitter = createLineSplitter((line) => {
      const parsed = parseCaptureLine(line, now())
      if (parsed.sample) {
        setStatus({ capturing: true, error: null })
        deps.onSample(parsed.sample)
        return
      }
      parseErrors += 1
      // 子进程还活着，只是这一行不可用；capturing 保持原状。
      const detail = parsed.error ?? '未知错误'
      setStatus({ capturing: status.capturing, error: `第 ${parseErrors} 条采样无效：${detail}` })
    })

    proc.stdout?.setEncoding('utf8')
    proc.stdout?.on('data', (chunk: string) => splitter(chunk))
    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (chunk: string) => {
      stderrTail = `${stderrTail}${chunk}`.slice(-400)
    })

    let closed = false
    function handleExit(reason: string): void {
      if (closed) return
      closed = true
      child = null
      if (!running) return
      const detail = stderrTail.trim()
      const text = detail ? `${reason}：${detail}` : reason
      if (now() - launchedAt >= STABLE_MS) restarts = 0
      const delay = RESTART_DELAYS_MS[restarts]
      if (delay === undefined) {
        setStatus({ capturing: false, error: `采集进程已停止（${text}）` })
        return
      }
      restarts += 1
      setStatus({ capturing: false, error: `采集进程中断（${text}），${delay / 1000} 秒后重启` })
      cancelRestart = schedule(() => {
        cancelRestart = null
        if (running) launch()
      }, delay)
    }

    proc.on('error', (error: Error) => handleExit(error.message))
    proc.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      handleExit(code === null ? `被信号 ${signal ?? '未知'} 结束` : `退出码 ${code}`)
    })
  }

  return {
    start(): void {
      if (running) return
      running = true
      restarts = 0
      launch()
    },
    stop(): void {
      running = false
      if (cancelRestart) {
        cancelRestart()
        cancelRestart = null
      }
      const proc = child
      child = null
      // 用任务树结束：PowerShell 可能在 Add-Type 期间派生 csc.exe，留着会成为孤儿。
      if (proc && proc.pid !== undefined && proc.exitCode === null && !proc.killed) killTree(proc.pid, proc)
      setStatus({ capturing: false, error: null })
    }
  }
}
