import { defineComponent } from 'vue'
import { honesty } from '@/data'
import Section from './Section'

export default defineComponent({
  name: 'SecuritySection',
  setup: () => () => (
    <Section id="security" title="Что инструмент делает с вашей машиной" kicker="УСТРОЙСТВО">
      {{
        default: ({ shown }: { shown?: string }) => (
          <div class="cols" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr))">
            {honesty.map((s, i) => (
              <div key={s.n} class="cell" data-reveal data-shown={shown} style={{ transitionDelay: i * 0.08 + 's' }}>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:clamp(24px,4vw,48px)">
                  <span class="kicker">{s.n}</span>
                  <span style="width:8px;height:8px;border-radius:50%;border:1px solid var(--line)" />
                </div>
                <div style="font-family:'Archivo',sans-serif;font-size:18px;font-weight:600;letter-spacing:-.02em;margin-bottom:10px">{s.title}</div>
                <p class="body">{s.text}</p>
              </div>
            ))}
          </div>
        ),
      }}
    </Section>
  ),
})
