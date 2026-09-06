import { defineComponent } from 'vue'
import { docGroups } from '@/site'
import { href } from '@/composables/useHashRoute'
import Section from './Section'

export default defineComponent({
  name: 'DocsSection',
  setup: () => () => (
    <Section id="install" title="Документация" kicker="ВТОРАЯ СТРАНИЦА">
      {{
        default: ({ shown }: { shown?: string }) => (
          <div class="cols" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr))">
            {docGroups.map((g, i) => (
              <div
                key={g.title}
                class="cell"
                data-reveal
                data-shown={shown}
                style={{ transitionDelay: i * 0.06 + 's', display: 'grid', gap: '12px', alignContent: 'start' }}
              >
                <div class="mono11" style="font-size:10px;letter-spacing:.16em">{g.title}</div>
                {g.items.map((it) => (
                  <a key={it} href={href('docs', 'install')} style="font-size:12.5px;line-height:1.6">{it}</a>
                ))}
              </div>
            ))}
          </div>
        ),
      }}
    </Section>
  ),
})
