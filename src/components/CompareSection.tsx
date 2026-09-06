import { defineComponent } from 'vue'
import { compareRows } from '@/data'
import Section from './Section'

const grid = 'display:grid;grid-template-columns:minmax(120px,1fr) minmax(140px,1.4fr) minmax(140px,1.4fr);gap:14px;padding:16px 20px'

export default defineComponent({
  name: 'CompareSection',
  setup: () => () => (
    <Section id="compare" title="Что перестаёте поддерживать руками" kicker="ДО / ПОСЛЕ">
      {{
        default: ({ shown }: { shown?: string }) => (
          <div class="grid" data-reveal data-shown={shown}>
            <div style={`background:var(--panel);${grid};padding:12px 20px;font-size:10px;letter-spacing:.14em;color:var(--muted)`}>
              <div>ОБЛАСТЬ</div>
              <div>СЕЙЧАС</div>
              <div>С :3000</div>
            </div>
            {compareRows.map((r) => (
              <div key={r.area} style={`background:var(--bg);${grid};font-size:12.5px;align-items:start`}>
                <div class="kicker" style="font-size:11px;letter-spacing:.08em">{r.area}</div>
                <div style="color:var(--muted)">{r.before}</div>
                <div style="display:flex;gap:10px">
                  <span style="color:var(--accent);flex:none">→</span>
                  <span>{r.after}</span>
                </div>
              </div>
            ))}
          </div>
        ),
      }}
    </Section>
  ),
})
