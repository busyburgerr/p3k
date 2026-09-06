import { inject, onMounted, onUnmounted, provide, ref, type InjectionKey } from 'vue'

/** Подписка одного элемента на общий наблюдатель страницы. */
type Register = (el: Element, onShow: () => void) => void

const RevealKey: InjectionKey<Register> = Symbol('reveal')

/**
 * Появление секций при скролле.
 *
 * Наблюдатель один на всю страницу и живёт в корне, а секции регистрируют себя
 * сами — поэтому App не хранит список id и они не могут разъехаться с разметкой.
 * Скрытое состояние в CSS включается только после старта наблюдателя
 * ([data-reveal-ready] на <html>): без JS или без IntersectionObserver контент
 * остаётся видимым, а не пропадает навсегда.
 */
export function provideReveal() {
  const shows = new WeakMap<Element, () => void>()
  const waiting = new Set<Element>()
  let io: IntersectionObserver | null = null

  const register: Register = (el, onShow) => {
    shows.set(el, onShow)
    if (io) io.observe(el)
    else waiting.add(el)
  }

  onMounted(() => {
    if (typeof IntersectionObserver === 'undefined') {
      waiting.forEach((el) => shows.get(el)?.())
      waiting.clear()
      return
    }
    document.documentElement.setAttribute('data-reveal-ready', '')
    io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return
          shows.get(e.target)?.()
          io?.unobserve(e.target)
        }),
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
    )
    waiting.forEach((el) => io?.observe(el))
    waiting.clear()
  })

  onUnmounted(() => {
    io?.disconnect()
    io = null
    document.documentElement.removeAttribute('data-reveal-ready')
  })

  provide(RevealKey, register)
}

/**
 * Флаг видимости для одного элемента. Возвращает ref под корень секции:
 * пока он не привязан или наблюдателя нет, элемент считается видимым.
 */
export function useReveal() {
  const el = ref<HTMLElement | null>(null)
  const shown = ref(false)
  const register = inject(RevealKey, null)

  onMounted(() => {
    if (register && el.value) register(el.value, () => (shown.value = true))
    else shown.value = true
  })

  /** Значение для data-shown — строка, потому что состояние читает CSS. */
  const attr = () => (shown.value ? 'on' : undefined)
  return { el, shown, attr }
}
