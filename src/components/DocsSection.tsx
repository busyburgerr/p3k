import { defineComponent } from 'vue'
import { docs } from '@/data.docs'
import { renderBlock } from './DocBlocks'
import Section from './Section'

export default defineComponent({
  name: 'DocsSection',
  setup: () => () => (
    <Section id="docs" title="Документация" kicker="ЧЕТЫРЕ КОМАНДЫ" headStyle="margin-bottom:20px">
      {{
        default: ({ shown }: { shown?: string }) => (
          <>
            <p style="font-size:13px;line-height:1.75;color:var(--muted);max-width:64ch;margin:0 0 32px;text-wrap:pretty">
              Описано только то, что в CLI действительно есть. Чего пока нет — перечислено в конце отдельным
              разделом, а не спрятано.
            </p>

            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:clamp(24px,3vw,48px);align-items:start">
              {/* Оглавление: на узком экране сетка сама ставит его над содержимым. */}
              <nav
                data-reveal
                data-shown={shown}
                style="position:sticky;top:88px;display:grid;gap:1px;background:var(--line);border:1px solid var(--line)"
              >
                {docs.map((s) => (
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
                {docs.map((s) => (
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
