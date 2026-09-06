import { defineComponent } from 'vue'
import InstallButton from './InstallButton'

export default defineComponent({
  name: 'CtaSection',
  setup: () => () => (
    <section id="cta" style="position:relative;padding:clamp(56px,8vw,120px) clamp(16px,4vw,56px);border-bottom:1px solid var(--line);overflow:hidden">
      <div class="dots" style="mask-image:radial-gradient(80% 120% at 50% 100%,#000 0%,transparent 70%)" />
      <div style="position:relative;max-width:820px;margin:0 auto;text-align:center">
        <div style="width:44px;height:44px;margin:0 auto 28px;border:1px solid var(--line);border-radius:50%;display:grid;place-items:center">
          <div style="width:12px;height:12px;border-radius:50%;background:var(--accent);animation:pulse 2.4s ease-in-out infinite" />
        </div>
        <h2 style="font-family:'Archivo',sans-serif;font-weight:700;font-size:clamp(30px,5vw,64px);letter-spacing:-.035em;line-height:1;margin:0 0 20px">
Поставьте<br />и попробуйте
        </h2>
        <p style="font-size:14px;line-height:1.7;color:var(--muted);max-width:48ch;margin:0 auto 36px">
          Инструмент работает только у вас на машине: ни аккаунта, ни подписки, ни сервера. Если что-то не
          поднимется, doctor назовёт причину.
        </p>
        <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center">
          <InstallButton big />
          <a href="#/docs" class="pill" style="padding:15px 24px;font-size:13px">Документация</a>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:12px 24px;justify-content:center;align-items:center;margin-top:36px;padding-top:26px;border-top:1px solid var(--line);font-size:11px;letter-spacing:.12em;color:var(--muted)">
          <span style="display:flex;align-items:center;gap:8px">
            <span style="width:7px;height:7px;border-radius:50%;background:var(--accent)" />
            ВЕРСИЯ 0.1 · РАННЯЯ РАЗРАБОТКА
          </span>
          <span>INIT · DEV · CHECK · DOCTOR</span>
          <a href="#/docs#doc-limits">ЧЕГО ПОКА НЕТ →</a>
        </div>
      </div>
    </section>
  ),
})
