import { describe, expect, it } from 'vitest'
import { WriteBuffer } from '../../src/main/store/buffer'
import type { Sample } from '../../src/shared/types'

function sample(t: number): Sample {
  return { t, exe: 'Code', title: 'dayfilm', idleMs: 0 }
}

interface HarnessOptions {
  limit?: number
  failures?: number
}

function harness(options: HarnessOptions = {}) {
  const written: Sample[] = []
  const errors: Array<string | null> = []
  const timers: Array<{ ms: number; run: () => void }> = []
  let failuresLeft = options.failures ?? 0

  const buffer = new WriteBuffer({
    limit: options.limit,
    retryMs: 5000,
    write: (item) => {
      if (failuresLeft > 0) {
        failuresLeft -= 1
        const error = new Error('disk full') as NodeJS.ErrnoException
        error.code = 'ENOSPC'
        throw error
      }
      written.push(item)
    },
    onError: (message) => errors.push(message),
    schedule: (fn, ms) => {
      const entry = { ms, run: fn }
      timers.push(entry)
      return () => {
        const index = timers.indexOf(entry)
        if (index >= 0) timers.splice(index, 1)
      }
    }
  })

  return { buffer, written, errors, timers }
}

describe('WriteBuffer', () => {
  it('正常路径直接落盘且不报错', () => {
    const { buffer, written, errors } = harness()
    buffer.push(sample(1))
    buffer.push(sample(2))
    expect(written.map((item) => item.t)).toEqual([1, 2])
    expect(buffer.pendingCount).toBe(0)
    expect(errors).toEqual([])
  })

  it('写失败时缓冲采样并给出可读错误，之后补写成功就清空', () => {
    const { buffer, written, errors } = harness({ failures: 2 })
    buffer.push(sample(1))
    expect(buffer.pendingCount).toBe(1)
    expect(written).toEqual([])
    expect(errors.at(-1)).toContain('ENOSPC')
    expect(errors.at(-1)).toContain('已缓冲 1 条采样')

    buffer.push(sample(2))
    expect(buffer.pendingCount).toBe(2)

    buffer.flush()
    expect(written.map((item) => item.t)).toEqual([1, 2])
    expect(buffer.pendingCount).toBe(0)
    expect(errors.at(-1)).toBeNull()
  })

  it('超过上限丢最旧的并计数', () => {
    const { buffer, errors } = harness({ limit: 3, failures: Number.POSITIVE_INFINITY })
    for (let index = 1; index <= 5; index += 1) buffer.push(sample(index))
    expect(buffer.pendingCount).toBe(3)
    expect(buffer.droppedCount).toBe(2)
    expect(errors.at(-1)).toContain('已丢弃最旧的 2 条')
  })

  it('每 5 秒重试一次，stop() 后不再调度', () => {
    const { buffer, timers, written } = harness({ failures: 1 })
    buffer.push(sample(1))
    expect(buffer.pendingCount).toBe(1)

    buffer.start()
    expect(timers.map((timer) => timer.ms)).toEqual([5000])
    timers.shift()?.run()
    expect(written.map((item) => item.t)).toEqual([1])
    expect(buffer.pendingCount).toBe(0)
    // 成功之后仍然继续按 5 秒节律检查
    expect(timers).toHaveLength(1)

    buffer.stop()
    expect(timers).toHaveLength(0)
  })

  it('drain() 报告是否已写完', () => {
    const { buffer } = harness({ failures: 1 })
    buffer.push(sample(1))
    expect(buffer.drain()).toBe(true)
    expect(buffer.pendingCount).toBe(0)
  })

  it('错误信息里不含窗口标题', () => {
    const { buffer, errors } = harness({ failures: 1 })
    buffer.push({ t: 1, exe: 'Code', title: '银行 - 私人账户', idleMs: 0 })
    expect(errors.at(-1)).not.toContain('银行')
    expect(errors.at(-1)).not.toContain('私人账户')
  })
})
