import { defineComponent } from 'vue'
import Section from './Section'

const key = 'color:oklch(0.72 0.15 300)'
const str = 'color:oklch(0.75 0.14 150)'

export default defineComponent({
  name: 'ConfigSection',
  setup: () => () => (
    <Section
      id="config"
      wrapStyle="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:clamp(28px,4vw,56px);align-items:center"
    >
      {{
        default: ({ shown }: { shown?: string }) => (
          <>
            <div data-reveal data-shown={shown}>
              <div class="kicker" style="letter-spacing:.18em;margin-bottom:20px">ОДИН ФАЙЛ</div>
              <h2 class="h2" style="font-size:clamp(26px,3.2vw,42px);line-height:1.06;margin-bottom:20px">
                Конфиг описывает проект, а не запускает его
              </h2>
              <p style="font-size:13.5px;line-height:1.75;color:var(--muted);max-width:44ch;margin:0 0 28px;text-wrap:pretty">
                Две секции: <span style="color:var(--ink)">processes</span> — из чего состоит окружение,
                <span style="color:var(--ink)"> checks</span> — что должно пройти перед мержем. Один и тот же файл
                читают dev и check.
              </p>
              <div class="grid" style="gap:1px">
                {[
                  'needs задаёт порядок, ready — по чему считать готовым',
                  'oneShot: шаг отрабатывает и выходит, не роняя окружение',
                  'JSON читается как данные и никогда не исполняется',
                ].map((t) => (
                  <div key={t} style="background:var(--bg);padding:14px 16px;display:flex;gap:12px;font-size:12.5px">
                    <span style="color:var(--accent)">→</span>
                    <span>{t}</span>
                  </div>
                ))}
              </div>
            </div>

            <div class="win" data-reveal data-shown={shown} style="transition-delay:.1s">
              <div class="winbar" style="font-size:10px;letter-spacing:.16em;color:var(--muted)">
                <span>P3K.JSON</span>
                <span>22 СТРОКИ</span>
              </div>
              <pre style="margin:0;padding:20px 18px;font-family:'JetBrains Mono',monospace;font-size:clamp(11px,.95vw,12.5px);line-height:1.9;overflow-x:auto">
                {'{\n  '}<span style={key}>"processes"</span>{': {\n'}
                {'    '}<span style={key}>"db"</span>{': {\n      '}<span style={key}>"command"</span>{': '}<span style={str}>"docker run --rm -p 5432:5432 postgres:16"</span>{',\n'}
                {'      '}<span style={key}>"ready"</span>{': { '}<span style={key}>"port"</span>{': '}<span style="color:var(--accent)">5432</span>{' },\n'}
                {'      '}<span style={key}>"stop"</span>{': '}<span style={str}>"docker stop app-db"</span>{'\n    },\n'}
                {'    '}<span style={key}>"migrate"</span>{': { '}<span style={key}>"command"</span>{': '}<span style={str}>"npm run migrate"</span>{',\n'}
                {'                 '}<span style={key}>"needs"</span>{': ['}<span style={str}>"db"</span>{'], '}<span style={key}>"oneShot"</span>{': '}<span style="color:var(--accent)">true</span>{' },\n'}
                {'    '}<span style={key}>"api"</span>{': { '}<span style={key}>"command"</span>{': '}<span style={str}>"npm run dev"</span>{', '}<span style={key}>"needs"</span>{': ['}<span style={str}>"migrate"</span>{'],\n'}
                {'             '}<span style={key}>"ready"</span>{': { '}<span style={key}>"port"</span>{': '}<span style="color:var(--accent)">4000</span>{' } }\n  },\n'}
                {'  '}<span style={key}>"checks"</span>{': {\n'}
                {'    '}<span style={key}>"types"</span>{':  { '}<span style={key}>"command"</span>{': '}<span style={str}>"npm run typecheck"</span>{' },\n'}
                {'    '}<span style={key}>"build"</span>{':  { '}<span style={key}>"command"</span>{': '}<span style={str}>"npm run build"</span>{' },\n'}
                {'    '}<span style={key}>"bundle"</span>{': { '}<span style={key}>"size"</span>{': { '}<span style={key}>"path"</span>{': '}<span style={str}>"dist"</span>{', '}<span style={key}>"max"</span>{': '}<span style={str}>"180kb"</span>{',\n'}
                {'                         '}<span style={key}>"gzip"</span>{': '}<span style="color:var(--accent)">true</span>{' },\n'}
                {'                '}<span style={key}>"needs"</span>{': ['}<span style={str}>"build"</span>{'] }\n  }\n}'}
              </pre>
            </div>
          </>
        ),
      }}
    </Section>
  ),
})
