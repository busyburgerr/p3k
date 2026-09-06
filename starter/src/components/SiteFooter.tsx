import { defineComponent } from 'vue'
import { nav } from '@/site'

export default defineComponent({
  name: 'SiteFooter',
  setup: () => () => (
    <footer style="display:flex;flex-wrap:wrap;gap:20px;align-items:center;justify-content:space-between;padding:26px clamp(16px,4vw,56px);font-size:11px;letter-spacing:.12em;color:var(--muted)">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="width:7px;height:7px;border-radius:50%;background:var(--accent)" />
        НАЗВАНИЕ САЙТА
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:14px 20px">
        {nav.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
      </div>
      <div>© 2026</div>
    </footer>
  ),
})
