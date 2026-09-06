import { defineComponent } from 'vue'
import { doctorPage } from '@/data.doctor'
import { renderBlock } from './DocBlocks'
import Section from './Section'

export default defineComponent({
  name: 'DoctorPage',
  setup: () => () => (
    <Section id="doctor" title="doctor" kicker="ПОЧЕМУ LOCALHOST ПУСТОЙ" headStyle="margin-bottom:20px">
      {{
        default: ({ shown }: { shown?: string }) => (
          <>
            <p style="font-size:13px;line-height:1.75;color:var(--muted);max-width:64ch;margin:0 0 32px;text-wrap:pretty">
              Единственная команда инструмента, у которой нет прямого аналога. Поэтому она вынесена на отдельную
              страницу, а не спрятана четвёртым пунктом в общем списке.
            </p>

            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:clamp(24px,3vw,48px);align-items:start">
              <nav
                data-reveal
                data-shown={shown}
                style="position:sticky;top:88px;display:grid;gap:1px;background:var(--line);border:1px solid var(--line)"
              >
                {doctorPage.map((s) => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    style="background:var(--bg);padding:12px 16px;font-size:11.5px;letter-spacing:.1em;color:var(--muted)"
                  >
                    {s.nav}
                  </a>
                ))}
              </nav>

              <div style="display:grid;gap:clamp(36px,5vw,64px);min-width:0;grid-column:span 2">
                {doctorPage.map((s) => (
                  <article key={s.id} id={s.id} style="display:grid;gap:20px;scroll-margin-top:88px">
                    <div>
                      <div class="kicker" style="letter-spacing:.16em;margin-bottom:10px">{s.kicker}</div>
                      <h3 style="font-family:'Archivo',sans-serif;font-weight:600;font-size:clamp(20px,2.2vw,28px);letter-spacing:-.02em;margin:0">
                        {s.title}
                      </h3>
                    </div>
                    {s.blocks.map(renderBlock)}
                  </article>
                ))}
              </div>
            </div>
          </>
        ),
      }}
    </Section>
  ),
})
