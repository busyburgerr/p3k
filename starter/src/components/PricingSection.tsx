import { defineComponent } from 'vue'
import { plans } from '@/site'
import Section from './Section'

export default defineComponent({
  name: 'PricingSection',
  setup: () => () => (
    <Section id="pricing" title="Цены" kicker="ТАРИФЫ">
      {{
        default: ({ shown }: { shown?: string }) => (
          <div class="cols" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))">
            {plans.map((p, i) => (
              <div
                key={p.name}
                class="cell"
                data-reveal
                data-shown={shown}
                style={{
                  transitionDelay: i * 0.08 + 's',
                  padding: 'clamp(22px,2.6vw,32px)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '22px',
                  outline: p.accent ? '1px solid var(--accent)' : undefined,
                  outlineOffset: p.accent ? '-1px' : undefined,
                }}
              >
                <div>
                  <div style={{ fontSize: '11px', letterSpacing: '.16em', color: p.accent ? 'var(--accent)' : 'var(--muted)', marginBottom: '18px' }}>
                    {p.name}
                  </div>
                  <div class="num" style="font-size:clamp(28px,3vw,38px);line-height:1">{p.price}</div>
                  <div style="font-size:11.5px;color:var(--muted);margin-top:8px">{p.sub}</div>
                </div>
                <div style="display:grid;gap:10px;font-size:12.5px;line-height:1.6">
                  {p.items.map((it) => (
                    <div key={it} style="display:flex;gap:10px">
                      <span style="color:var(--accent);flex:none">→</span>
                      <span>{it}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ),
      }}
    </Section>
  ),
})
