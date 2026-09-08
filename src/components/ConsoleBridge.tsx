import { defineComponent } from 'vue'
import { docsHref } from '@/composables/useHashRoute'
import { docs } from '@/data.docs'
import { templates } from '@/data.templates'
import { plural } from '@/plural'
import Section from './Section'

/** Счётчики берём из самих данных — иначе они разъедутся с содержимым. */
const rows = [
  { href: docsHref('templates'), label: 'Шаблоны проектов', meta: String(templates.length), accent: false },
  { href: docsHref('doc-ship'), label: 'Выкатка на свой сервер', meta: 'выпуски и откат', accent: false },
  { href: docsHref('doc-dev'), label: 'Справочник команд', meta: '6', accent: false },
  { href: docsHref('doc-go'), label: 'Библиотека для Go', meta: 'вторая реализация', accent: false },
  { href: docsHref('doc-limits'), label: 'Чего пока нет', meta: 'список', accent: true },
]

export default defineComponent({
  name: 'ConsoleBridge',
  setup: () => () => (
    <Section
      sectionStyle="padding:clamp(40px,5vw,80px) clamp(16px,4vw,56px)"
      wrapStyle="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:clamp(20px,3vw,40px);align-items:end"
    >
      {{
        default: () => (
          <>
            <div>
              <div class="kicker" style="letter-spacing:.18em;margin-bottom:16px">ДОКУМЕНТАЦИЯ</div>
              <h2 class="h2" style="font-size:clamp(24px,3vw,38px);margin-bottom:14px;max-width:26ch">
                {plural(docs.length, 'раздел', 'раздела', 'разделов')}: команды, ресурсы, выкатка и границы
              </h2>
              <p style="font-size:13px;line-height:1.75;color:var(--muted);max-width:52ch;margin:0 0 24px;text-wrap:pretty">
                Описано только то, что действительно работает. Отдельный раздел перечисляет, чего в инструменте
                нет — чтобы это не пришлось выяснять в процессе.
              </p>
              <div style="display:flex;flex-wrap:wrap;gap:12px">
                <a href={docsHref()} class="pill solid" style="padding:13px 22px">Открыть документацию →</a>
                <a href={docsHref('doc-start')} class="pill" style="padding:13px 22px;color:var(--muted)">Начало</a>
              </div>
            </div>
            <div class="grid">
              {rows.map((r) => (
                <a key={r.label} href={r.href} style="background:var(--bg);padding:15px 18px;display:flex;justify-content:space-between;gap:14px;font-size:12.5px">
                  <span>{r.label}</span>
                  <span style={{ color: r.accent ? 'var(--accent)' : 'var(--muted)' }}>{r.meta}</span>
                </a>
              ))}
            </div>
          </>
        ),
      }}
    </Section>
  ),
})
