import { onUnmounted, ref } from 'vue'

/** Кнопка «копировать» с временной подписью об успехе. */
export function useCopy(text: string, label = 'COPY', done = 'СКОПИРОВАНО') {
  const state = ref(label)
  let timer: number | undefined

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* без доступа к буферу просто показываем отклик */
    }
    state.value = done
    window.clearTimeout(timer)
    timer = window.setTimeout(() => (state.value = label), 1600)
  }

  onUnmounted(() => window.clearTimeout(timer))
  return { state, copy }
}
