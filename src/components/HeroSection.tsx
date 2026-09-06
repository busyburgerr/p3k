import { defineComponent, onMounted } from 'vue'
import { useTerminal } from '@/composables/useTerminal'
import InstallButton from './InstallButton'

/** Всё, что здесь стоит, можно проверить в исходниках CLI. */
const stats = [
  { v: '4', l: 'КОМАНДЫ' },
  { v: '0', l: 'ЗАВИСИМОСТЕЙ' },
  { v: '18+', l: 'NODE' },
]

export default defineComponent({
  name: 'HeroSection',
  setup() {
    const { tab, typed, lines, pick, start, labels } = useTerminal()
    onMounted(start)

    return () => (
      <section style="position:relative;padding:clamp(48px,7vw,110px) clamp(16px,4vw,56px) clamp(40px,5vw,80px);border-bottom:1px solid var(--line)">
        <div class="dots" style="mask-image:radial-gradient(120% 90% at 70% 0%,#000 10%,transparent 70%)" />
        <div style="position:relative;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr));gap:clamp(28px,4vw,56px);align-items:start;max-width:1440px;margin:0 auto">
          <div>
            <div style="display:flex;align-items:center;gap:10px;font-size:11px;letter-spacing:.18em;color:var(--muted);margin-bottom:28px">
              <span style="width:6px;height:6px;border-radius:50%;background:var(--accent)" />
              ПОЧЕМУ LOCALHOST ПУСТОЙ
            </div>
            <h1 style="font-family:'Archivo',sans-serif;font-weight:700;font-size:clamp(40px,6.4vw,86px);line-height:.94;letter-spacing:-.035em;margin:0 0 24px">
              Сервер сказал<br />«ready».<br />Страница пустая.
            </h1>
            <p style="font-size:clamp(14px,1.2vw,16px);line-height:1.65;color:var(--muted);max-width:46ch;margin:0 0 36px;text-wrap:pretty">
              <span style="color:var(--ink)">doctor</span> находит причину за секунду и печатает команду, которая её
              чинит. Тот же инструмент поднимает окружение по одному конфигу и прогоняет проверки до пуша — но
              начните с этого. Без сервера, аккаунта и подписки.
            </p>
            <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:44px">
              <InstallButton />
              <a href="#doctor" class="pill" style="padding:14px 22px;font-size:13px">Показать пример →</a>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:1px;background:var(--line);border:1px solid var(--line)">
              {stats.map((s) => (
                <div key={s.l} style="background:var(--bg);padding:18px 16px">
                  <div class="num" style="font-size:26px">{s.v}</div>
                  <div class="mono11" style="font-size:10px;margin-top:6px">{s.l}</div>
                </div>
              ))}
            </div>
          </div>

          <div class="win" style="box-shadow:0 30px 80px -50px rgba(0,0,0,.8)">
            <div class="winbar">
              <div style="display:flex;gap:7px">
                <span class="dotbtn" />
                <span class="dotbtn" />
                <span class="dotbtn" style="background:var(--accent);border-color:transparent" />
              </div>
              <div style="display:flex;gap:6px">
                {labels.value.map((l, i) => (
                  <button key={l} class={['tab', tab.value === i ? 'on' : '']} style="font-size:10px;padding:6px 11px" onClick={() => pick(i)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div style="padding:20px 18px;min-height:340px;font-size:clamp(11px,1vw,13px);line-height:1.85">
              {lines.value.map((l, i) => (
                <div key={i} style="display:flex;gap:10px;white-space:pre-wrap;word-break:break-word">
                  <span style={{ color: l.prefixColor, flex: 'none' }}>{l.prefix}</span>
                  <span style={{ color: l.textColor }}>{l.text}</span>
                </div>
              ))}
              <div style="display:flex;gap:10px;white-space:pre-wrap;word-break:break-word">
                <span style="color:var(--accent);flex:none">$</span>
                <span>
                  {typed.value}
                  <span class="caret" style="margin-left:2px;transform:translateY(2px)" />
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    )
  },
})
