import { defineComponent, ref, onMounted, onUnmounted, watch } from 'vue'
import type { Theme } from '@/composables/useTheme'
import { docsHref, homeHref, href } from '@/composables/useHashRoute'

const links = [
  { href: href('doctor'), label: 'DOCTOR' },
  { href: href('recipes'), label: 'РЕЦЕПТЫ' },
  { href: homeHref('flow'), label: 'КОМАНДЫ' },
  { href: homeHref('config'), label: 'КОНФИГ' },
  { href: homeHref('start'), label: 'СТАРТ' },
  { href: docsHref(), label: 'ДОКУМЕНТАЦИЯ' },
]

/** Тот же порог, что и у сеток в styles.css — держим брейкпоинт в CSS, а не в замерах. */
const NARROW = '(max-width: 859.98px)'

export default defineComponent({
  name: 'SiteHeader',
  props: {
    theme: { type: String as () => Theme, required: true },
    route: { type: String, default: '' },
  },
  emits: ['toggleTheme'],
  setup(props, { emit }) {
    /**
     * Раскладка шапки идёт от медиазапроса, а не от замера innerWidth:
     * значение верное уже на первом рендере (иначе на телефоне сначала
     * мелькала десктопная навигация) и пересчитывается только на смене
     * брейкпоинта, а не на каждом кадре ресайза.
     */
    const mq = window.matchMedia(NARROW)
    const narrow = ref(mq.matches)
    const menu = ref(false)
    const onBreakpoint = (e: MediaQueryListEvent) => (narrow.value = e.matches)

    onMounted(() => mq.addEventListener('change', onBreakpoint))
    onUnmounted(() => mq.removeEventListener('change', onBreakpoint))
    /** На широком экране кнопки меню нет — иначе открытый список остаётся висеть. */
    watch(narrow, (isNarrow) => { if (!isNarrow) menu.value = false })

    const toTop = () => {
      menu.value = false
      if (props.route !== '') window.location.hash = ''
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }

    return () => (
      <>
        <header
          style="position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px clamp(16px,4vw,56px);border-bottom:1px solid var(--line);background:color-mix(in oklab,var(--bg) 88%,transparent);backdrop-filter:blur(12px)"
        >
          <div style="display:flex;align-items:center;gap:12px">
            <button
              title="Наверх"
              onClick={toTop}
              style="display:flex;align-items:center;gap:12px;background:transparent;border:none;padding:0;cursor:pointer;color:var(--ink)"
            >
              <span style="width:22px;height:22px;border:1px solid var(--line);border-radius:50%;display:grid;place-items:center">
                <span style="width:7px;height:7px;border-radius:50%;background:var(--accent);animation:pulse 2.4s ease-in-out infinite" />
              </span>
              <span style="font-family:'Archivo',sans-serif;font-weight:700;font-size:22px;line-height:1;letter-spacing:-.03em">:3000</span>
            </button>
            <div style="font-size:10px;letter-spacing:.16em;color:var(--muted);border:1px solid var(--line);border-radius:2px;padding:3px 6px">
              {props.route === '' ? 'V0.2 · РАННЯЯ' : props.route.toUpperCase()}
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:clamp(12px,2vw,30px)">
            {!narrow.value && (
              <nav style="display:flex;align-items:center;gap:clamp(14px,2vw,30px);font-size:12px;letter-spacing:.1em;color:var(--muted)">
                {links.map((l) => (
                  <a key={l.href} href={l.href}>{l.label}</a>
                ))}
              </nav>
            )}
            <button class="tab" onClick={() => emit('toggleTheme')}>
              {props.theme === 'dark' ? 'СВЕТЛАЯ' : 'ТЁМНАЯ'}
            </button>
            {!narrow.value && (
              <a href="#cta" class="pill solid" style="font-size:12px;letter-spacing:.1em;padding:9px 18px">НАЧАТЬ</a>
            )}
            {narrow.value && (
              <button
                aria-label="Меню"
                aria-expanded={menu.value}
                onClick={() => (menu.value = !menu.value)}
                style="display:flex;flex-direction:column;gap:4px;padding:10px;background:transparent;border:1px solid var(--line);border-radius:8px;cursor:pointer"
              >
                <span style="width:16px;height:1px;background:var(--ink)" />
                <span style="width:16px;height:1px;background:var(--ink)" />
                <span style="width:16px;height:1px;background:var(--ink)" />
              </button>
            )}
          </div>
        </header>

        {menu.value && (
          <div style="position:sticky;top:57px;z-index:19;display:grid;gap:1px;background:var(--line);border-bottom:1px solid var(--line)">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => (menu.value = false)}
                style="background:var(--bg);padding:16px clamp(16px,4vw,56px);font-size:12px;letter-spacing:.12em;color:var(--muted)"
              >
                {l.label}
              </a>
            ))}
            <a href="#cta" onClick={() => (menu.value = false)} style="background:var(--bg);padding:16px clamp(16px,4vw,56px);font-size:12px;letter-spacing:.12em;color:var(--accent)">
              НАЧАТЬ →
            </a>
          </div>
        )}
      </>
    )
  },
})
