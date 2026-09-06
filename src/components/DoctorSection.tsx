import { defineComponent } from 'vue'
import { doctorPitch } from '@/data.doctor'
import { href } from '@/composables/useHashRoute'
import Section from './Section'

/** Витрина на главной: не четвёртый пункт списка, а отдельный разворот. */
export default defineComponent({
  name: 'DoctorSection',
  setup: () => () => (
    <Section
      id="doctor"
      sectionStyle="background:var(--panel)"
      wrapStyle="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:clamp(28px,4vw,56px);align-items:center"
    >
      {{
        default: ({ shown }: { shown?: string }) => (
          <>
            <div data-reveal data-shown={shown}>
              <div class="kicker" style="letter-spacing:.18em;margin-bottom:20px;color:var(--accent)">
                {doctorPitch.kicker}
              </div>
              <h2 class="h2" style="font-size:clamp(26px,3.4vw,44px);line-height:1.06;margin-bottom:20px;max-width:18ch">
                {doctorPitch.title}
              </h2>
              <p style="font-size:13.5px;line-height:1.75;color:var(--muted);max-width:46ch;margin:0 0 20px;text-wrap:pretty">
                {doctorPitch.text}
              </p>
              <p style="font-size:12.5px;line-height:1.7;color:var(--muted);max-width:46ch;margin:0 0 28px;border-left:1px solid var(--accent);padding-left:16px;text-wrap:pretty">
                {doctorPitch.after}
              </p>
              <div style="display:flex;flex-wrap:wrap;gap:12px">
                <a href={href('doctor')} class="pill solid" style="padding:13px 22px">Как это устроено →</a>
                <a href="#flow" class="pill" style="padding:13px 22px;color:var(--muted)">Остальные команды</a>
              </div>
            </div>

            <div class="win" data-reveal data-shown={shown} style="transition-delay:.1s;background:var(--bg)">
              <div class="winbar" style="font-size:10px;letter-spacing:.16em;color:var(--muted)">
                <span>P3K DOCTOR</span>
                <span style="color:var(--accent)">КОД ВОЗВРАТА 1</span>
              </div>
              <pre style="margin:0;padding:20px 18px;font-family:'JetBrains Mono',monospace;font-size:clamp(11px,.95vw,12.5px);line-height:1.9;overflow-x:auto">
                {doctorPitch.output.join('\n')}
              </pre>
            </div>
          </>
        ),
      }}
    </Section>
  ),
})
