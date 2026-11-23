/**
 * 放映机声音：底噪 + 剪辑咔哒，全部用 WebAudio 生成，不依赖任何音频文件。
 * 默认关闭；音量与模式来自设置（0 时完全静音），关闭时释放 AudioContext。
 */
export interface ProjectorAudio {
  setEnabled(on: boolean): void
  /** 0–1；0 时完全静音（电平条也随之归零） */
  setVolume(volume: number): void
  /** projector = 底噪 + 剪辑；cuts = 只有剪辑 */
  setMode(mode: 'projector' | 'cuts'): void
  click(): void
  dispose(): void
  /** 最近一段（~200ms）的 RMS 电平，0–1；未开启或无 AudioContext 时为 0。 */
  level(): number
}

interface Noise {
  source: AudioBufferSourceNode
  gain: GainNode
}

function noop(): void {
  /* 无 AudioContext 时保持静默 */
}

/** 底噪与咔哒的基准增益：volume 0.35 时分别 0.014 / 0.091，与旧版手调值一致。 */
const NOISE_BASE = 0.04
const CLICK_BASE = 0.26

export function createProjectorAudio(): ProjectorAudio {
  let ctx: AudioContext | null = null
  let noise: Noise | null = null
  let analyser: AnalyserNode | null = null
  let samples: Float32Array<ArrayBuffer> | null = null
  let enabled = false
  let volume = 0.35
  let mode: 'projector' | 'cuts' = 'projector'

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

  const stopNoise = (): void => {
    if (!noise) return
    try {
      noise.source.stop()
    } catch {
      /* 已经停过 */
    }
    noise.source.disconnect()
    noise.gain.disconnect()
    noise = null
    analyser = null
    samples = null
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
    gain.gain.value = NOISE_BASE * volume
    // 电平表：8192 样本 ≈ 170ms（48kHz），接近“最近 200ms”
    const meter = context.createAnalyser()
    meter.fftSize = 8192
    meter.smoothingTimeConstant = 0.4
    samples = new Float32Array(new ArrayBuffer(meter.fftSize * 4))
    analyser = meter
    source.connect(band).connect(gain).connect(meter).connect(context.destination)
    source.start()
    return { source, gain }
  }

  const startNoiseIfNeeded = (context: AudioContext): void => {
    if (noise) {
      noise.gain.gain.value = NOISE_BASE * volume
      return
    }
    noise = startNoise(context)
  }

  return {
    setEnabled(on: boolean): void {
      enabled = on
      if (!on) {
        stopNoise()
        return
      }
      const context = ensure()
      if (!context) return
      void context.resume()
      if (mode === 'projector') startNoiseIfNeeded(context)
    },
    setVolume(next: number): void {
      volume = Math.min(1, Math.max(0, Number.isFinite(next) ? next : 0))
      if (noise) noise.gain.gain.value = NOISE_BASE * volume
    },
    setMode(next: 'projector' | 'cuts'): void {
      mode = next
      const context = ctx
      if (!enabled || !context) return
      if (next === 'projector') startNoiseIfNeeded(context)
      else stopNoise()
    },
    click(): void {
      // 「仅剪辑」模式没有底噪，但咔哒仍要能响：有 ctx 就发
      if (!ctx || volume <= 0) return
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
      gain.gain.setValueAtTime(CLICK_BASE * volume, at)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05)
      source.connect(band).connect(gain).connect(context.destination)
      source.start(at)
      source.stop(at + 0.06)
    },
    dispose(): void {
      stopNoise()
      enabled = false
      if (ctx) {
        void ctx.close().catch(noop)
        ctx = null
      }
    },
    level(): number {
      if (!analyser || !samples || volume <= 0) return 0
      analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (const value of samples) sum += value * value
      const rms = Math.sqrt(sum / samples.length)
      // 底噪 RMS 约 0.0012（gain 后），×350 ≈ 0.45 能亮两格；剪辑咔哒会顶到满格
      return Math.min(1, rms * 350)
    }
  }
}
