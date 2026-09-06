import { nextTick, onMounted, onUnmounted, ref } from 'vue'

/**
 * Маршрутизация по хэшу без роутера.
 *
 * Форма ссылки: '#/<маршрут>#<якорь>'. Главная страница — просто '#<якорь>'.
 * Список маршрутов задаётся один раз при вызове, всё остальное считается главной.
 */

/** '#/docs#doc-start' при routes ['docs'] → { route: 'docs', anchor: 'doc-start' }. */
export function parseHash(hash: string, routes: readonly string[]): { route: string; anchor: string } {
  const path = hash.replace(/^#/, '')
  for (const name of routes) {
    const base = `/${name}`
    if (path === base || path.startsWith(`${base}#`)) {
      return { route: name, anchor: path.slice(base.length).replace(/^#/, '') }
    }
  }
  /** Второй replace — ради ссылок вида '#/#anchor', оставшихся от старой разметки. */
  return { route: '', anchor: path.replace(/^\/+/, '').replace(/^#/, '') }
}

/** Ссылка на секцию любого маршрута: работает с любой страницы сайта. */
export function href(route: string, anchor?: string) {
  if (!route) return anchor ? `#${anchor}` : '#'
  return anchor ? `#/${route}#${anchor}` : `#/${route}`
}

/** Документация — единственная отдельная страница сайта. */
export const docsHref = (anchor?: string) => href('docs', anchor)

/** Ссылка на секцию главной страницы. */
export const homeHref = (anchor: string) => href('', anchor)

export function useHashRoute(routes: readonly string[] = []) {
  const initial = parseHash(window.location.hash, routes)
  const route = ref(initial.route)

  /**
   * Прокрутку к якорю делаем сами: при смене маршрута браузер ищет элемент
   * сразу, когда нужная страница ещё не отрисована, и молча остаётся наверху.
   */
  const scrollToAnchor = (anchor: string) => {
    if (!anchor) return
    nextTick(() =>
      requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' })),
    )
  }

  const onHash = () => {
    const next = parseHash(window.location.hash, routes)
    route.value = next.route
    scrollToAnchor(next.anchor)
  }

  onMounted(() => {
    window.addEventListener('hashchange', onHash)
    scrollToAnchor(initial.anchor)
  })
  onUnmounted(() => window.removeEventListener('hashchange', onHash))

  return { route }
}
