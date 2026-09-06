import { computed, onUnmounted, ref } from 'vue'
import { steps, toneColor } from '@/data'

export interface TermLine { prefix: string; text: string; prefixColor: string; textColor: string }

export function useTerminal(speed = 42) {
  const tab = ref(0)
  const typed = ref('')
  const lines = ref<TermLine[]>([])
  const manual = ref(false)
  let si = 0
  let ci = 0
  let timer: number | undefined

  const tick = () => {
    const step = steps[si % steps.length]
    if (ci <= step.cmd.length) {
      typed.value = step.cmd.slice(0, ci)
      ci += 1
      timer = window.setTimeout(tick, speed)
      return
    }
    const done: TermLine[] = [
      ...lines.value,
      { prefix: '$', text: step.cmd, prefixColor: 'var(--accent)', textColor: 'var(--ink)' },
      ...step.outs.map((o) => ({ prefix: o.prefix, text: o.text, prefixColor: toneColor(o.tone), textColor: 'var(--muted)' })),
    ]
    if (manual.value) {
      typed.value = ''
      lines.value = done.slice(-9)
      return
    }
    si += 1
    ci = 0
    const reset = si % steps.length === 0
    typed.value = ''
    lines.value = reset ? [] : done.slice(-9)
    tab.value = si % steps.length
    timer = window.setTimeout(tick, reset ? 1400 : 800)
  }

  const start = () => { timer = window.setTimeout(tick, 300) }

  /** Клик по табу останавливает автоплей и показывает выбранную команду. */
  const pick = (i: number) => {
    window.clearTimeout(timer)
    manual.value = true
    si = i
    ci = 0
    tab.value = i
    lines.value = []
    typed.value = ''
    timer = window.setTimeout(tick, 120)
  }

  onUnmounted(() => window.clearTimeout(timer))

  const labels = computed(() => steps.map((s) => s.cmd.split(' ')[1].toUpperCase()))
  return { tab, typed, lines, pick, start, labels }
}
