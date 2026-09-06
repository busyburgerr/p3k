import { defineComponent } from 'vue'
import { templates } from '@/data.templates'
import { docsHref } from '@/composables/useHashRoute'
import Section from './Section'

export default defineComponent({
  name: 'TemplatesSection',
  setup: () => () => (
    <Section
      id="templates"
      title="Шаблон — это ещё и конфиг"
      kicker={`${templates.length} ШАБЛОНА`}
      headStyle="margin-bottom:20px"
    >
      {{
        default: ({ shown }: { shown?: string }) => (
          <>
            <p style="font-size:13px;line-height:1.75;color:var(--muted);max-width:62ch;margin:0 0 28px;text-wrap:pretty">
              Кроме исходников шаблон приносит <span style="color:var(--ink)">p3k.json</span>: из чего проект
              состоит, что от чего зависит и какие проверки должны пройти. Поэтому сразу после init работают и{' '}
              <span style="color:var(--ink)">dev</span>, и <span style="color:var(--ink)">check</span> — без единой
              правки.
            </p>
            <div class="cols" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));margin-bottom:24px">
              {templates.map((t, i) => (
                <div
                  key={t.name}
                  class="cell"
                  data-reveal
                  data-shown={shown}
                  style={{ transitionDelay: i * 0.06 + 's', padding: 'clamp(18px,2.2vw,26px)', display: 'flex', flexDirection: 'column', gap: '16px' }}
                >
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                    <div style="font-size:13px">{t.name}</div>
                    <span style="width:7px;height:7px;border-radius:50%;border:1px solid var(--line)" />
                  </div>
                  <div style="font-size:12px;line-height:1.7;color:var(--muted)">{t.stack}</div>
                  <div style="margin-top:auto;display:flex;flex-wrap:wrap;gap:8px 16px;font-size:10px;letter-spacing:.12em;color:var(--muted);border-top:1px dashed var(--line);padding-top:12px">
                    <span>{t.processes}</span>
                    <span>{t.needs}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">
              <div class="pill" style="cursor:default">
                <span style="color:var(--accent)">$</span>
                p3k init мой-сайт --template static
              </div>
              <a href={docsHref('doc-start')} class="pill" style="color:var(--muted)">Что дальше →</a>
            </div>
            <p style="font-size:11.5px;line-height:1.7;color:var(--muted);margin:20px 0 0;max-width:62ch">
              Своих шаблонов пока не подключить — это в{' '}
              <a href={docsHref('doc-limits')} style="color:var(--accent)">списке того, чего ещё нет</a>.
            </p>
          </>
        ),
      }}
    </Section>
  ),
})
