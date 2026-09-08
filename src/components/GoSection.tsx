import { defineComponent } from 'vue'
import { docsHref } from '@/composables/useHashRoute'
import Section from './Section'

/**
 * Код на Go подсвечиваем по одному правилу: комментарии приглушены, остальное
 * как есть. Полноценная подсветка потребовала бы разбора языка, а разница на
 * двух коротких примерах — в пределах погрешности.
 */
const code = (lines: string[]) =>
  lines.map((line, i) => (
    <div key={i} style={{ color: line.trimStart().startsWith('//') ? 'var(--muted)' : 'var(--ink)', minHeight: '1.85em' }}>
      {line}
    </div>
  ))

const TEST_MAIN = [
  'func TestMain(m *testing.M) {',
  '    cfg, _ := p3k.LoadDir(".")',
  '    env := p3k.New(cfg, p3k.WithOnly("postgres", "redis"))',
  '',
  '    // Возвращается, когда база начала отвечать,',
  '    // а не когда контейнер запущен.',
  '    if err := env.Start(ctx); err != nil {',
  '        log.Fatal(err)',
  '    }',
  '',
  '    code := m.Run()',
  '',
  '    // Гасит в обратном порядке и снимает всё дерево.',
  '    env.Stop(ctx)',
  '    os.Exit(code)',
  '}',
]

const OWN_READY = [
  '// Готовность бывает своя: здесь окружение считается',
  '// поднятым, только когда миграции отработали.',
  'migrated := p3k.Exec(',
  '    `docker exec shop-db psql -U postgres ` +',
  '    `-c "select 1 from пользователи limit 1"`,',
  ')',
  '',
  'env := p3k.New(cfg, p3k.WithReady("postgres", migrated))',
  '',
  '// Условие — это интерфейс с двумя методами,',
  '// так что своё пишется в несколько строк.',
]

const facts = [
  ['45', 'ТЕСТОВ'],
  ['0', 'ЗАВИСИМОСТЕЙ'],
  ['1.21+', 'GO'],
]

export default defineComponent({
  name: 'GoSection',
  setup: () => () => (
    <Section id="go" title="Две реализации, один конфиг" kicker="ЕЩЁ ЕСТЬ БИБЛИОТЕКА ДЛЯ GO">
      {{
        default: ({ shown }: { shown?: string }) => (
          <>
            <div data-reveal data-shown={shown} style="max-width:74ch;margin-bottom:clamp(28px,4vw,48px)">
              <p style="font-size:13.5px;line-height:1.8;color:var(--muted);margin:0 0 14px;text-wrap:pretty">
                То же самое, но не утилитой, а библиотекой: окружение поднимается{' '}
                <span style="color:var(--ink)">внутри вашей программы</span>, и его можно дождаться, прочитать и
                погасить. Тот же p3k.json, те же правила, ноль зависимостей.
              </p>
              <p style="font-size:13.5px;line-height:1.8;color:var(--muted);margin:0;text-wrap:pretty">
                Чаще всего это нужно интеграционным тестам, которым требуются настоящие база и кэш, а не заглушки.
              </p>
            </div>

            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:clamp(20px,3vw,32px)">
              <div class="win" data-reveal data-shown={shown}>
                <div class="winbar" style="font-size:10px;letter-spacing:.16em;color:var(--muted)">
                  <span>ИНТЕГРАЦИОННЫЕ ТЕСТЫ</span>
                  <span>MAIN_TEST.GO</span>
                </div>
                <pre style="margin:0;padding:20px 18px;font-family:'JetBrains Mono',monospace;font-size:clamp(11px,.95vw,12.5px);line-height:1.85;overflow-x:auto">
                  {code(TEST_MAIN)}
                </pre>
              </div>

              <div class="win" data-reveal data-shown={shown} style="transition-delay:.1s">
                <div class="winbar" style="font-size:10px;letter-spacing:.16em;color:var(--muted)">
                  <span>СВОЁ УСЛОВИЕ ГОТОВНОСТИ</span>
                  <span>ENV.GO</span>
                </div>
                <pre style="margin:0;padding:20px 18px;font-family:'JetBrains Mono',monospace;font-size:clamp(11px,.95vw,12.5px);line-height:1.85;overflow-x:auto">
                  {code(OWN_READY)}
                </pre>
              </div>
            </div>

            <div
              data-reveal
              data-shown={shown}
              style="margin-top:clamp(28px,4vw,48px);display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:clamp(20px,3vw,40px);align-items:center"
            >
              <p style="font-size:13px;line-height:1.75;color:var(--muted);max-width:52ch;margin:0;text-wrap:pretty">
                На Windows дерево процессов снимает ядро — даже если саму программу сняли принудительно. Версия на
                Node так не умеет: там для этого нужен нативный модуль, и это записано у неё в ограничениях.
              </p>

              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:1px;background:var(--line);border:1px solid var(--line)">
                {facts.map(([v, l]) => (
                  <div key={l} style="background:var(--bg);padding:16px 14px">
                    <div class="num" style="font-size:22px">{v}</div>
                    <div class="mono11" style="font-size:10px;margin-top:6px">{l}</div>
                  </div>
                ))}
              </div>
            </div>

            <div data-reveal data-shown={shown} style="margin-top:clamp(24px,3vw,36px);display:flex;flex-wrap:wrap;gap:12px">
              <a href={docsHref('doc-go')} class="pill solid" style="padding:13px 22px">
                Как это устроено →
              </a>
              <a
                href="https://github.com/busyburgerr/p3k/tree/main/go"
                class="pill"
                style="padding:13px 22px;color:var(--muted)"
                rel="noreferrer"
              >
                Исходники
              </a>
            </div>
          </>
        ),
      }}
    </Section>
  ),
})
