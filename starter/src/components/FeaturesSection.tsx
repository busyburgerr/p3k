import { defineComponent } from 'vue'
import { features } from '@/site'
import Section from './Section'

export default defineComponent({
  name: 'FeaturesSection',
  setup: () => () => (
    <Section id="features" title="Заголовок секции" kicker="01 — 03">
      {{
        default: ({ shown }: { shown?: string }) => (
          <div class="cols">
            {features.map((f, i) => (
              <div key={f.n} class="cell" data-reveal data-shown={shown} style={{ transitionDelay: i * 0.08 + 's' }}>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:clamp(30px,5vw,64px)">
                  <span class="kicker">{f.n}</span>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: i === 0 ? 'var(--accent)' : 'transparent', border: i === 0 ? 'none' : '1px solid var(--line)' }} />
                </div>
                <div style="font-family:'Archivo',sans-serif;font-size:20px;font-weight:600;letter-spacing:-.02em;margin-bottom:12px">{f.name}</div>
                <p class="body">{f.text}</p>
              </div>
            ))}
          </div>
        ),
      }}
    </Section>
  ),
})
