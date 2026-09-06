import { defineComponent } from 'vue'
import { docsHref, homeHref, href } from '@/composables/useHashRoute'

const links = [
  { href: href('doctor'), label: 'DOCTOR' },
  { href: homeHref('flow'), label: 'КОМАНДЫ' },
  { href: homeHref('compare'), label: 'СРАВНЕНИЕ' },
  { href: homeHref('security'), label: 'УСТРОЙСТВО' },
  { href: homeHref('start'), label: 'СТАРТ' },
  { href: homeHref('faq'), label: 'FAQ' },
  { href: docsHref('doc-limits'), label: 'ГРАНИЦЫ' },
]

export default defineComponent({
  name: 'SiteFooter',
  setup: () => () => (
    <footer style="display:flex;flex-wrap:wrap;gap:20px;align-items:center;justify-content:space-between;padding:26px clamp(16px,4vw,56px);font-size:11px;letter-spacing:.12em;color:var(--muted)">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="width:7px;height:7px;border-radius:50%;background:var(--accent)" />
        :3000 — CLI ДЛЯ ЛОКАЛЬНОГО ОКРУЖЕНИЯ
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:14px 20px">
        {links.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
      </div>
      <div>© 2026</div>
    </footer>
  ),
})
