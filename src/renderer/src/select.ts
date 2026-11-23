/**
 * 自绘下拉框（替换原生 select）：触发器 + 浮层面板，键盘与 ARIA 按 combobox 规范。
 * 纯逻辑在 lib/select.ts；这里只做 DOM 与事件。
 */
import { SELECT_PANEL_MARGIN, initialHighlight, moveHighlight, panelPlacement } from './lib/select'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectConfig {
  /** 触发器与面板的无障碍名 */
  label: string
  className?: string
  options: readonly SelectOption[]
  value: string
  onChange(value: string): void
}

export interface SelectHandle {
  readonly element: HTMLElement
  setOptions(options: readonly SelectOption[], value: string): void
  setValue(value: string): void
  getValue(): string
  focus(): void
}

let selectSeq = 0

function chevron(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 8 5')
  svg.setAttribute('class', 'select__chevron')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M0 0 L4 5 L8 0')
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1')
  svg.append(path)
  return svg
}

export function createSelect(config: SelectConfig): SelectHandle {
  selectSeq += 1
  const listId = `select-list-${selectSeq}`
  const element = document.createElement('div')
  element.className = config.className === undefined ? 'select' : `select ${config.className}`

  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'select__trigger'
  trigger.setAttribute('role', 'combobox')
  trigger.setAttribute('aria-haspopup', 'listbox')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.setAttribute('aria-controls', listId)
  trigger.setAttribute('aria-label', config.label)

  const valueEl = document.createElement('span')
  valueEl.className = 'select__value'
  trigger.append(valueEl, chevron())

  const panel = document.createElement('div')
  panel.className = 'select__panel'
  panel.id = listId
  panel.setAttribute('role', 'listbox')
  panel.setAttribute('aria-label', config.label)
  panel.hidden = true

  element.append(trigger, panel)

  let options: readonly SelectOption[] = config.options
  let value = config.value
  let highlight = -1
  let open = false

  const selectedIndex = (): number => options.findIndex((option) => option.value === value)

  function renderRows(): void {
    panel.replaceChildren(
      ...options.map((option, index) => {
        const row = document.createElement('div')
        row.className = 'select__option'
        row.id = `${listId}-${index}`
        row.setAttribute('role', 'option')
        row.setAttribute('aria-selected', String(option.value === value))
        row.textContent = option.label
        row.dataset.index = String(index)
        return row
      })
    )
    if (highlight < 0 && options.length > 0) highlight = initialHighlight(selectedIndex(), options.length)
    paintHighlight()
  }

  function paintHighlight(): void {
    for (const [index, row] of [...panel.children].entries()) {
      const el = row as HTMLElement
      el.classList.toggle('is-selected', options[index]?.value === value)
      el.classList.toggle('is-active', index === highlight)
      el.setAttribute('aria-selected', String(options[index]?.value === value))
    }
    if (highlight >= 0 && options[highlight] !== undefined) {
      trigger.setAttribute('aria-activedescendant', `${listId}-${highlight}`)
      const el = panel.children[highlight] as HTMLElement | undefined
      if (el !== undefined) {
        // 只滚面板自己：滚视口会触发 window 的 scroll 监听把面板关掉
        const top = el.offsetTop
        if (top < panel.scrollTop) panel.scrollTop = top
        else if (top + el.offsetHeight > panel.scrollTop + panel.clientHeight) {
          panel.scrollTop = top + el.offsetHeight - panel.clientHeight
        }
      }
    } else {
      trigger.removeAttribute('aria-activedescendant')
    }
  }

  function paintValue(): void {
    const option = options.find((item) => item.value === value)
    valueEl.textContent = option?.label ?? ''
    trigger.title = option?.label ?? ''
  }

  function place(): void {
    const rect = trigger.getBoundingClientRect()
    const width = Math.max(240, Math.ceil(rect.width))
    panel.style.minWidth = `${width}px`
    const height = panel.offsetHeight
    const placement = panelPlacement(rect, height, window.innerHeight)
    let left = rect.left
    if (left + width > window.innerWidth - SELECT_PANEL_MARGIN) {
      left = Math.max(SELECT_PANEL_MARGIN, window.innerWidth - width - SELECT_PANEL_MARGIN)
    }
    panel.dataset.placement = placement
    panel.style.left = `${Math.round(left)}px`
    panel.style.top =
      placement === 'down'
        ? `${Math.round(rect.bottom + 6)}px`
        : `${Math.round(rect.top - height - 6)}px`
  }

  function setOpen(next: boolean): void {
    if (next === open) return
    open = next
    panel.hidden = !open
    trigger.setAttribute('aria-expanded', String(open))
    if (open) {
      highlight = initialHighlight(selectedIndex(), options.length)
      renderRows()
      place()
      trigger.focus({ preventScroll: true })
      document.addEventListener('pointerdown', onOutside, true)
      window.addEventListener('resize', close)
      window.addEventListener('scroll', onScroll, true)
    } else {
      highlight = selectedIndex()
      trigger.removeAttribute('aria-activedescendant')
      document.removeEventListener('pointerdown', onOutside, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }

  function close(): void {
    setOpen(false)
  }

  /** 只关掉“别处滚动”，面板自己滚动不算。 */
  function onScroll(event: Event): void {
    const target = event.target
    if (target instanceof Node && panel.contains(target)) return
    close()
  }

  function commit(index: number): void {
    const option = options[index]
    if (option === undefined) return
    const changed = option.value !== value
    value = option.value
    paintValue()
    setOpen(false)
    trigger.focus({ preventScroll: true })
    if (changed) config.onChange(value)
  }

  function onOutside(event: PointerEvent): void {
    const target = event.target
    if (target instanceof Node && (element.contains(target) || panel.contains(target))) return
    close()
  }

  function onTriggerKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault()
      if (!open) setOpen(true)
      else commit(highlight)
      return
    }
    if (event.key === 'Escape') {
      if (!open) return
      event.preventDefault()
      close()
      return
    }
    if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      setOpen(true)
      return
    }
    if (!open) return
    const next = moveHighlight(highlight, event.key, options.length)
    if (next === highlight) return
    event.preventDefault()
    highlight = next
    paintHighlight()
  }

  trigger.addEventListener('click', () => setOpen(!open))
  trigger.addEventListener('keydown', onTriggerKey)
  // 只在键盘操作时显示焦点环：鼠标点击（含程序化 focus）不画矩形框
  const markKeyboard = (): void => {
    element.dataset.input = 'keyboard'
  }
  const markPointer = (): void => {
    element.dataset.input = 'pointer'
  }
  element.addEventListener('pointerdown', markPointer, true)
  element.addEventListener('keydown', markKeyboard, true)
  panel.addEventListener('pointerdown', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const row = target.closest<HTMLElement>('.select__option')
    if (row === null) return
    event.preventDefault()
    commit(Number(row.dataset.index))
  })
  panel.addEventListener('pointermove', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const row = target.closest<HTMLElement>('.select__option')
    if (row === null) return
    const index = Number(row.dataset.index)
    if (index === highlight) return
    highlight = index
    paintHighlight()
  })
  element.addEventListener('focusout', (event) => {
    if (!open) return
    const next = event.relatedTarget
    if (next instanceof Node && (element.contains(next) || panel.contains(next))) return
    // 焦点离开整组（Tab 出去）就收面板
    if (next !== null) close()
  })

  const handle: SelectHandle = {
    element,
    setOptions(next, nextValue) {
      options = next
      value = nextValue
      highlight = initialHighlight(selectedIndex(), options.length)
      paintValue()
      if (open) {
        renderRows()
        place()
      }
    },
    setValue(nextValue) {
      value = nextValue
      highlight = initialHighlight(selectedIndex(), options.length)
      paintValue()
      paintHighlight()
    },
    getValue: () => value,
    focus: () => trigger.focus({ preventScroll: true })
  }

  paintValue()
  renderRows()
  return handle
}
