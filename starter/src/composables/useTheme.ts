import { onMounted, ref, watchEffect } from 'vue'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'theme'

/**
 * Тема пишется атрибутом на <html> — палитра в styles.css переключается по
 * [data-theme='light'], поэтому ни один компонент про тему знать не обязан.
 */
export function useTheme(fallback: Theme = 'dark') {
  const theme = ref<Theme>(fallback)

  onMounted(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'dark' || saved === 'light') theme.value = saved
    else if (window.matchMedia('(prefers-color-scheme: light)').matches) theme.value = 'light'
  })

  watchEffect(() => {
    document.documentElement.setAttribute('data-theme', theme.value)
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, theme.value)
  })

  const toggle = () => (theme.value = theme.value === 'dark' ? 'light' : 'dark')
  return { theme, toggle }
}
