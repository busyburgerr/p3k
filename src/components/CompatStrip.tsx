import { defineComponent } from 'vue'
import { compat } from '@/data'

/** Проверенное и непроверенное разведены: обещать второе как первое нельзя. */
const groups = [
  { label: 'ПРОВЕРЕНО НА', items: compat.tested, color: 'var(--ink)' },
  { label: 'НЕ ПРОВЕРЕНО', items: compat.untested, color: 'var(--muted)' },
  { label: 'ОПЦИОНАЛЬНО', items: compat.optional, color: 'var(--muted)' },
]

export default defineComponent({
  name: 'CompatStrip',
  setup: () => () => (
    <section style="padding:22px clamp(16px,4vw,56px);border-bottom:1px solid var(--line);overflow:hidden">
      <div class="wrap" style="display:flex;flex-wrap:wrap;align-items:center;gap:14px 32px;font-size:11px;letter-spacing:.14em;color:var(--muted)">
        {groups.map((g) => (
          <div key={g.label} style="display:flex;flex-wrap:wrap;align-items:center;gap:12px">
            <span style="color:var(--ink)">{g.label}</span>
            {g.items.map((item) => (
              <span key={item} style={{ color: g.color }}>{item}</span>
            ))}
          </div>
        ))}
      </div>
    </section>
  ),
})
