/**
 * 放映机声音：底噪 + 剪辑咔哒，全部用 WebAudio 生成，不依赖任何音频文件。
 * 默认关闭；关闭时立即静音并释放 AudioContext。
 */
export interface ProjectorAudio {
  setEnabled(on: boolean): void
  click(): void
  dispose(): void
}

interface Noise {
  source: AudioBufferSourceNode
  gain: GainNode
}

function noop(): void {
  /* 无 AudioContext 时保持静默 */
}

export function createProjectorAudio(): ProjectorAudio {
  let ctx: AudioContext | null = null
  let noise: Noise | null = null

  const ensure = (): AudioContext | null => {
    if (ctx) return ctx
    const Ctor =
      typeof window === 'undefined'
        ? undefined
        : window.AudioContext ??
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    try {
      ctx = new Ctor()
    } catch {
      ctx = null
    }
    return ctx
  }

  const startNoise = (context: AudioContext): Noise => {
    // 2 秒噪声循环，带通后就是放映机的低鸣
    const length = Math.floor(context.sampleRate * 2)
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1
    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    const band = context.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 320
    band.Q.value = 0.7
    const gain = context.createGain()
    gain.gain.value = 0.014
    source.connect(band).connect(gain).connect(context.destination)
    source.start()
    return { source, gain }
  }

  return {
    setEnabled(on: boolean): void {
      const context = ensure()
      if (!context) return
      if (on) {
        void context.resume()
        if (!noise) noise = startNoise(context)
        return
      }
      if (noise) {
        noise.source.stop()
        noise.source.disconnect()
        noise.gain.disconnect()
        noise = null
      }
    },
    click(): void {
      if (!ctx || !noise) return
      const context = ctx
      const at = context.currentTime
      const length = Math.floor(context.sampleRate * 0.03)
      const buffer = context.createBuffer(1, length, context.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / length)
      }
      const source = context.createBufferSource()
      source.buffer = buffer
      const band = context.createBiquadFilter()
      band.type = 'bandpass'
      band.frequency.value = 2400
      band.Q.value = 1.4
      const gain = context.createGain()
      gain.gain.setValueAtTime(0.09, at)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05)
      source.connect(band).connect(gain).connect(context.destination)
      source.start(at)
      source.stop(at + 0.06)
    },
    dispose(): void {
      if (noise) {
        try {
          noise.source.stop()
        } catch {
          /* 已经停过 */
        }
        noise.source.disconnect()
        noise.gain.disconnect()
        noise = null
      }
      if (ctx) {
        void ctx.close().catch(noop)
        ctx = null
      }
    }
  }
}
