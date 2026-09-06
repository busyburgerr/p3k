import { ref } from 'vue'

export function useCopy(text: string, label = 'COPY', done = 'СКОПИРОВАНО') {
  const state = ref(label)
  const copy = async () => {
    try { await navigator.clipboard.writeText(text) } catch { /* без клипборда — просто показываем отклик */ }
    state.value = done
    window.setTimeout(() => (state.value = label), 1600)
  }
  return { state, copy }
}
