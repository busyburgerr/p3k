import { defineComponent } from 'vue'
import { quickstart } from '@/data'
import Section from './Section'

export default defineComponent({
  name: 'StartSection',
  setup: () => () => (
    <Section id="start" title="Первые пять минут" kicker="ДЛЯ НОВИЧКОВ">
      {{
        default: ({ shown }: { shown?: string }) => (
          <>
            <div class="cols" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));margin-bottom:24px">
              {quickstart.map((s, i) => (
                <div key={s.cmd} class="cell" data-reveal data-shown={shown} style={{ transitionDelay: i * 0.08 + 's', padding: 'clamp(20px,2.4vw,28px)' }}>
                  <div class="kicker" style="margin-bottom:16px">ШАГ {i + 1}</div>
                  <div style="font-size:13px;margin-bottom:14px">
                    <span style="color:var(--accent)">$ </span>
                    {s.cmd}
                  </div>
                  <p class="body" style="margin-bottom:14px">{s.text}</p>
                  <div style="font-size:11.5px;line-height:1.7;color:var(--muted);border-top:1px dashed var(--line);padding-top:12px">
                    <span style="color:var(--ok)">✓ </span>
                    {s.out}
                  </div>
                </div>
              ))}
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;font-size:12.5px;color:var(--muted)">
              <a href="#faq" class="pill">Разбор шаблонов →</a>
              <span>
                Если что-то не поднялось — <a href="#faq" style="color:var(--accent)">типовые ошибки</a> и Discord с ответом
                за пару часов.
              </span>
            </div>
          </>
        ),
      }}
    </Section>
  ),
})
