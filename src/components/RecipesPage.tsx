import { defineComponent } from 'vue'
import { recipes } from '@/data.recipes'
import { renderBlock } from './DocBlocks'
import Section from './Section'

export default defineComponent({
  name: 'RecipesPage',
  setup: () => () => (
    <Section id="recipes" title="Готовые конфиги" kicker="РЕЦЕПТЫ" headStyle="margin-bottom:20px">
      {{
        default: ({ shown }: { shown?: string }) => (
          <>
            <p style="font-size:13px;line-height:1.75;color:var(--muted);max-width:64ch;margin:0 0 32px;text-wrap:pretty">
              Настоящие стеки, а не «hello world»: база в контейнере, миграции, кэш, воркеры. Каждый конфиг
              разбирается тем же парсером, что и рабочий — если бы он был сломан, сборка сайта не прошла бы.
            </p>

            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:clamp(24px,3vw,48px);align-items:start">
              <nav
                data-reveal
                data-shown={shown}
                style="position:sticky;top:88px;display:grid;gap:1px;background:var(--line);border:1px solid var(--line)"
              >
                {recipes.map((r) => (
                  <a
                    key={r.id}
                    href={`#${r.id}`}
                    style="background:var(--bg);padding:12px 16px;font-size:11.5px;letter-spacing:.1em;color:var(--muted)"
                  >
                    {r.nav}
                  </a>
                ))}
              </nav>

              <div style="display:grid;gap:clamp(40px,6vw,72px);min-width:0;grid-column:span 2">
                {recipes.map((r) => (
                  <article key={r.id} id={r.id} style="display:grid;gap:20px;scroll-margin-top:88px">
                    <div>
                      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:baseline;margin-bottom:10px">
                        <span class="kicker" style="letter-spacing:.16em">{r.kicker}</span>
                        {r.requires && (
                          <span style="font-size:10px;letter-spacing:.12em;color:var(--accent);border:1px solid var(--line);border-radius:2px;padding:2px 6px">
                            НУЖЕН {r.requires.toUpperCase()}
                          </span>
                        )}
                      </div>
                      <h3 style="font-family:'Archivo',sans-serif;font-weight:600;font-size:clamp(20px,2.2vw,28px);letter-spacing:-.02em;margin:0 0 10px">
                        {r.title}
                      </h3>
                      <p style="font-size:12.5px;line-height:1.7;color:var(--muted);margin:0;max-width:64ch">{r.summary}</p>
                    </div>

                    <div class="win">
                      <div class="winbar" style="font-size:10px;letter-spacing:.16em;color:var(--muted)">
                        <span>P3K.JSON</span>
                        <span>{r.config.length} СТРОК</span>
                      </div>
                      <pre style="margin:0;padding:18px clamp(14px,2vw,20px);font-family:'JetBrains Mono',monospace;font-size:clamp(11px,.95vw,12.5px);line-height:1.85;overflow-x:auto">
                        {r.config.join('\n')}
                      </pre>
                    </div>

                    {r.blocks.map(renderBlock)}
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
