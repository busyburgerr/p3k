import { ref, watchEffect } from 'vue'

export type Theme = 'dark' | 'light'

export function useTheme(initial: Theme = 'dark') {
  const theme = ref<Theme>(initial)
  watchEffect(() => document.documentElement.setAttribute('data-theme', theme.value))
  const toggle = () => (theme.value = theme.value === 'dark' ? 'light' : 'dark')
  return { theme, toggle }
}
