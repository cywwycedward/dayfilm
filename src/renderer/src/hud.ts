/**
 * 导演 HUD 页面：读 window.dayfilm 的 live/onTick，把 lib/hud 的视图模型贴到 DOM。
 * 没有 preload（浏览器自查）时退到 mock，数据形状与真实一致。
 */
import type { LiveState } from '../../shared/types'
import { buildMockLive } from './mock'
import { hudView } from './lib/hud'
import { isoDate } from './lib/time'

interface HudApi {
  live?: () => Promise<LiveState>
  onTick?: (cb: (state: LiveState) => void) => () => void
  setHud?: (visible: boolean) => Promise<unknown>
  openMain?: () => Promise<unknown> | unknown
}

function need<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`缺少 HUD 元素 #${id}`)
  return found as T
}

const root = need<HTMLElement>('hud')
const dot = need<HTMLButtonElement>('hudDot')
const stateEl = need<HTMLElement>('hudState')
const exeEl = need<HTMLElement>('hudExe')
const elapsedEl = need<HTMLElement>('hudElapsed')
const elapsedPrefixEl = need<HTMLElement>('hudElapsedPrefix')
const titleEl = need<HTMLElement>('hudTitle')
const rhythmEl = need<HTMLElement>('hudRhythm')
const shotsEl = need<HTMLElement>('hudShots')
const cutsEl = need<HTMLElement>('hudCuts')
const verdictEl = need<HTMLElement>('hudVerdict')

// SAFETY: 预加载脚本可能落后于 shared 契约（openMain 等未声明），只按可选成员读取并逐个 typeof 守卫
const api = (window as unknown as { dayfilm?: HudApi }).dayfilm
let current: LiveState | null = null
let bars: HTMLSpanElement[] = []

function ensureBars(count: number): void {
  if (bars.length === count) return
  rhythmEl.replaceChildren()
  bars = []
  for (let index = 0; index < count; index += 1) {
    const bar = document.createElement('span')
    bar.className = 'hud__bar'
    rhythmEl.append(bar)
    bars.push(bar)
  }
}

function paint(now: number): void {
  if (!current) return
  const view = hudView(current, now)
  root.dataset.mood = view.mood
  stateEl.textContent = view.status
  exeEl.textContent = view.exe
  titleEl.textContent = view.title
  elapsedEl.textContent = view.elapsedText
  elapsedPrefixEl.hidden = view.elapsedPrefix.length === 0
  elapsedPrefixEl.textContent = view.elapsedPrefix
  shotsEl.textContent = String(view.today.shots)
  cutsEl.textContent = String(view.today.cuts)
  verdictEl.textContent = view.today.verdict
  ensureBars(view.rhythm.length)
  view.rhythm.forEach((bar, index) => {
    bars[index].style.height = `${bar.height}px`
  })
}

function mockTick(): void {
  current = buildMockLive(isoDate(Date.now()), Date.now())
}

function openMain(): void {
  if (!api) return
  if (typeof api.openMain === 'function') {
    void api.openMain()
    return
  }
  // 主进程还没暴露 openMain 时的占位：至少让 HUD 保持可见
  if (typeof api.setHud === 'function') void api.setHud(true)
}

async function boot(): Promise<void> {
  if (api?.live) {
    try {
      current = await api.live()
    } catch {
      current = null
    }
    api.onTick?.((state) => {
      current = state
      paint(Date.now())
    })
  } else {
    mockTick()
    window.setInterval(mockTick, 2000)
  }
  paint(Date.now())
  // 秒表秒级跳动：不依赖 onTick 的 2 秒节奏
  window.setInterval(() => paint(Date.now()), 1000)
  dot.addEventListener('click', openMain)
}

void boot()
