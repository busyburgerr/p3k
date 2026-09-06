import { defineComponent } from 'vue'
import { useCopy } from '@/composables/useCopy'
import { href } from '@/composables/useHashRoute'

export default defineComponent({
  name: 'HeroSection',
  setup() {
    const { state, copy } = useCopy('npm create vite@latest')

    return () => (
      <section style="position:relative;padding:clamp(48px,7vw,110px) clamp(16px,4vw,56px);border-bottom:1px solid var(--line);overflow:hidden">
        <div class="dots" style="mask-image:radial-gradient(120% 90% at 70% 0%,#000 10%,transparent 70%)" />
        <div class="wrap" style="position:relative">
          <div class="kicker" style="margin-bottom:28px">ПОДЗАГОЛОВОК НАД ЗАГОЛОВКОМ</div>
          <h1 style="font-family:'Archivo',sans-serif;font-weight:700;font-size:clamp(40px,6.4vw,86px);line-height:.94;letter-spacing:-.035em;margin:0 0 24px;max-width:16ch">
            Заголовок в две-три строки
          </h1>
          <p style="font-size:clamp(14px,1.2vw,16px);line-height:1.65;color:var(--muted);max-width:46ch;margin:0 0 36px;text-wrap:pretty">
            Один абзац о том, что это и кому нужно. Держите его коротким — дальше по странице будет место для деталей.
          </p>
          <div style="display:flex;flex-wrap:wrap;gap:12px">
            <button class="pill solid" style="gap:14px;padding:14px 22px;font-size:13px" onClick={copy}>
              <span>npm create vite@latest</span>
              <span style="opacity:.6;font-size:11px;letter-spacing:.1em">{state.value}</span>
            </button>
            <a href={href('', 'features')} class="pill" style="padding:14px 22px;font-size:13px">Что внутри →</a>
          </div>
        </div>
      </section>
    )
  },
})
