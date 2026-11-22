import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { createCapture, createLineSplitter, killProcessTree, parseCaptureLine, resolveCaptureScript, taskkillArgs, type CaptureStatus } from '../../src/main/capture'
import type { Sample } from '../../src/shared/types'

const NOW = new Date(2026, 10, 22, 9, 0, 0).getTime()

describe('resolveCaptureScript', () => {
  it('开发时取仓库里的 resources/capture.ps1', () => {
    const path = resolveCaptureScript({ isPackaged: false, appPath: 'C:\\app', resourcesPath: 'C:\\app\\out' })
    expect(path).toBe('C:\\app\\resources\\capture.ps1')
  })

  it('打包后取 process.resourcesPath 下的脚本', () => {
    const path = resolveCaptureScript({ isPackaged: true, appPath: 'C:\\app\\resources\\app.asar', resourcesPath: 'C:\\app\\resources' })
    expect(path).toBe('C:\\app\\resources\\capture.ps1')
  })
})

describe('createLineSplitter', () => {
  it('跨块半行留到下一块，CRLF 去掉 \\r', () => {
    const lines: string[] = []
    const feed = createLineSplitter((line) => lines.push(line))
    feed('{"ok":true,"tit')
    feed('le":"Herdr"}\r\n{"ok":true')
    feed(',"title":"Dayfilm"}\n')
    expect(lines).toEqual(['{"ok":true,"title":"Herdr"}', '{"ok":true,"title":"Dayfilm"}'])
  })

  it('忽略空行', () => {
    const lines: string[] = []
    const feed = createLineSplitter((line) => lines.push(line))
    feed('\n\n a \n')
    expect(lines).toEqual([' a '])
  })
})

describe('parseCaptureLine', () => {
  it('把脚本输出解析成带采样时刻的 Sample', () => {
    const parsed = parseCaptureLine('{"ok":true,"title":"dayfilm - Visual Studio Code","exe":"Code","idleMs":1200}', NOW)
    expect(parsed.error).toBeNull()
    expect(parsed.sample).toEqual({ t: NOW, exe: 'Code', title: 'dayfilm - Visual Studio Code', idleMs: 1200 })
  })

  it('标题截断到 512 字符，idleMs 取整不为负', () => {
    const long = 'x'.repeat(600)
    const parsed = parseCaptureLine(`{"ok":true,"title":"${long}","exe":"Code","idleMs":-3}`, NOW)
    expect(parsed.sample?.title).toHaveLength(512)
    expect(parsed.sample?.idleMs).toBe(0)
  })

  it('脚本报错时给出可读原因', () => {
    expect(parseCaptureLine('{"ok":false,"error":"no foreground window"}', NOW)).toEqual({
      sample: null,
      error: 'no foreground window'
    })
    expect(parseCaptureLine('{"ok":false}', NOW).error).toBe('采集失败')
  })

  it('坏 JSON 与字段类型不符只返回错误，不抛异常', () => {
    expect(parseCaptureLine('{ not json', NOW).sample).toBeNull()
    expect(parseCaptureLine('[]', NOW).error).toBe('采样输出不是 JSON 对象')
    expect(parseCaptureLine('{"ok":true,"title":"x","exe":"Code","idleMs":"12"}', NOW).error).toBe('采样字段缺失或类型不符')
  })
})

class FakeChild extends EventEmitter {
  static readonly PID = 4242
  readonly pid = FakeChild.PID
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  exitCode: number | null = null
  killed = false

  kill(): boolean {
    this.killed = true
    return true
  }

  exit(code: number): void {
    this.exitCode = code
    this.stdout.end()
    this.emit('exit', code, null)
  }
}

describe('createCapture 监督', () => {
  function harness() {
    const spawned: FakeChild[] = []
    const spawnedArgs: Array<{ command: string; args: string[] }> = []
    const killed: number[] = []
    const timers: Array<{ ms: number; run: () => void }> = []
    const statuses: CaptureStatus[] = []
    const samples: Sample[] = []
    const capture = createCapture({
      script: 'C:\\app\\resources\\capture.ps1',
      onSample: (sample) => samples.push(sample),
      onStatus: (status) => statuses.push(status),
      spawnChild: (command, args) => {
        spawnedArgs.push({ command, args })
        const child = new FakeChild()
        spawned.push(child)
        return child as unknown as ChildProcess
      },
      killTree: (pid, child) => {
        killed.push(pid)
        child.kill()
      },
      now: () => 1_000,
      schedule: (fn, ms) => {
        const entry = { ms, run: fn }
        timers.push(entry)
        return () => {
          const index = timers.indexOf(entry)
          if (index >= 0) timers.splice(index, 1)
        }
      }
    })
    return { capture, spawned, spawnedArgs, killed, timers, statuses, samples }
  }

  it('拉起脚本时把自己的 pid 作为 -ParentPid 传入', () => {
    const { capture, spawnedArgs } = harness()
    capture.start()
    expect(spawnedArgs[0].command).toBe('powershell.exe')
    expect(spawnedArgs[0].args).toEqual([
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'C:\\app\\resources\\capture.ps1',
      '-ParentPid',
      String(process.pid)
    ])
  })

  it('拉到脚本后解析出采样，并清楚标记采集中断后按 1s/3s/9s 重启三次', () => {
    const { capture, spawned, timers, statuses, samples } = harness()
    capture.start()
    expect(spawned).toHaveLength(1)

    spawned[0].stdout.write('{"ok":true,"title":"dayfilm","exe":"Code","idleMs":10}\n')
    expect(samples).toEqual([{ t: 1_000, exe: 'Code', title: 'dayfilm', idleMs: 10 }])
    expect(statuses.at(-1)).toEqual({ capturing: true, error: null })

    for (const delay of [1000, 3000, 9000]) {
      spawned[spawned.length - 1].exit(1)
      expect(statuses.at(-1)?.capturing).toBe(false)
      expect(timers).toHaveLength(1)
      expect(timers[0].ms).toBe(delay)
      timers.shift()?.run()
    }
    expect(spawned).toHaveLength(4)

    spawned[spawned.length - 1].exit(1)
    expect(timers).toHaveLength(0)
    expect(statuses.at(-1)?.error).toContain('已停止')
  })

  it('脚本报错时保留采集中断提示，不抛异常', () => {
    const { capture, spawned, statuses } = harness()
    capture.start()
    spawned[0].stdout.write('{"ok":false,"error":"no foreground window"}\n')
    expect(statuses.at(-1)?.error).toContain('no foreground window')
    expect(statuses.every((status) => !status.capturing)).toBe(true)
    capture.stop()
  })

  it('stop() 通过 killTree 整树结束子进程且不再重启', () => {
    const { capture, spawned, killed, timers } = harness()
    capture.start()
    capture.stop()
    expect(killed).toEqual([FakeChild.PID])
    expect(spawned[0].killed).toBe(true)
    spawned[0].exit(0)
    expect(timers).toHaveLength(0)
    expect(spawned).toHaveLength(1)
  })
})

describe('killProcessTree', () => {
  function fakeSpawn() {
    const calls: Array<{ command: string; args: string[] }> = []
    const killer = new EventEmitter()
    const spawnProcess = (command: string, args: string[]): ChildProcess => {
      calls.push({ command, args })
      return killer as unknown as ChildProcess
    }
    return { calls, killer, spawnProcess }
  }

  function fakeProcess() {
    const kills = { count: 0 }
    const child = {
      kill: () => {
        kills.count += 1
        return true
      }
    } as unknown as ChildProcess
    return { child, kills }
  }

  it('taskkill 参数是 /PID <pid> /T /F', () => {
    expect(taskkillArgs(4242)).toEqual(['/PID', '4242', '/T', '/F'])
  })

  it('Windows 上用 taskkill 整树结束，taskkill 成功时不再补 kill', () => {
    if (process.platform !== 'win32') return
    const { calls, killer, spawnProcess } = fakeSpawn()
    const { child, kills } = fakeProcess()

    killProcessTree(4242, child, spawnProcess)
    expect(calls).toEqual([{ command: 'taskkill', args: ['/PID', '4242', '/T', '/F'] }])
    killer.emit('exit', 0, null)
    expect(kills.count).toBe(0)
  })

  it('taskkill 失败或报错时退回 child.kill()', () => {
    if (process.platform !== 'win32') return
    const failed = fakeSpawn()
    const first = fakeProcess()
    killProcessTree(4242, first.child, failed.spawnProcess)
    failed.killer.emit('exit', 1, null)
    expect(first.kills.count).toBe(1)

    const broken = fakeSpawn()
    const second = fakeProcess()
    killProcessTree(4243, second.child, broken.spawnProcess)
    broken.killer.emit('error', new Error('spawn ENOENT'))
    expect(second.kills.count).toBe(1)
  })
})
