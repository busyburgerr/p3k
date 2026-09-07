import { defineComponent } from 'vue'
import { flow } from '@/data'
import Section from './Section'

export default defineComponent({
  name: 'FlowSection',
  setup: () => () => (
    <Section id="flow" title="Пять шагов, одна утилита" kicker="01 — 05">
      {{
        default: ({ shown }: { shown?: string }) => (
          <div class="cols">
            {flow.map((s, i) => (
              <div key={s.name} class="cell" data-reveal data-shown={shown} style={{ transitionDelay: i * 0.08 + 's' }}>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:clamp(30px,5vw,64px)">
                  <span class="kicker">{s.n}</span>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: i === 0 ? 'var(--accent)' : 'transparent', border: i === 0 ? 'none' : '1px solid var(--line)' }} />
                </div>
                <div style="font-family:'Archivo',sans-serif;font-size:20px;font-weight:600;letter-spacing:-.02em;margin-bottom:12px">{s.name}</div>
                <p class="body">{s.text}</p>
              </div>
            ))}
          </div>
        ),
      }}
    </Section>
  ),
})
