import { defineComponent } from 'vue'
import { proof } from '@/data'
import { docsHref } from '@/composables/useHashRoute'
import Section from './Section'

export default defineComponent({
  name: 'ProofSection',
  setup: () => () => (
    <Section id="proof" title="Где проект сейчас" kicker="БЕЗ ПРИКРАС" headStyle="margin-bottom:24px">
      {{
        default: ({ shown }: { shown?: string }) => (
          <>
            <p style="font-size:13.5px;line-height:1.75;color:var(--muted);max-width:62ch;margin:0 0 36px;text-wrap:pretty">
              Инструмент в ранней разработке. Полезен на своей машине уже сейчас, но половина того, что обычно
              обещают на таких страницах, здесь не написана — и об этом сказано прямо, а не мелким шрифтом.
            </p>
            <div class="cols" style="margin-bottom:24px">
              {proof.map((d, i) => (
                <div key={d.kicker} class="cell" data-reveal data-shown={shown} style={{ transitionDelay: i * 0.08 + 's', display: 'flex', flexDirection: 'column', gap: '18px' }}>
                  <div style="font-size:11px;letter-spacing:.16em;color:var(--accent)">{d.kicker}</div>
                  <p style="font-size:13.5px;line-height:1.75;margin:0;text-wrap:pretty">{d.text}</p>
                  <div class="kicker" style="margin-top:auto;letter-spacing:.1em">{d.note}</div>
                </div>
              ))}
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:12px">
              <a href={docsHref('doc-limits')} class="pill">
                <span style="width:7px;height:7px;border-radius:50%;background:var(--accent)" />
                Полный список того, чего нет
              </a>
            </div>
          </>
        ),
      }}
    </Section>
  ),
})
