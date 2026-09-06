import { defineComponent, ref } from 'vue'
import { faq } from '@/data'
import Section from './Section'

export default defineComponent({
  name: 'FaqSection',
  setup() {
    const open = ref(0)
    return () => (
      <Section id="faq" title="Частые вопросы" kicker="FAQ">
        {{
          default: () => (
            <div class="grid">
              {faq.map((item, i) => (
                <div key={item.q} style="background:var(--bg)">
                  <button
                    aria-expanded={open.value === i}
                    onClick={() => (open.value = open.value === i ? -1 : i)}
                    style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:20px;text-align:left;background:transparent;border:none;cursor:pointer;padding:20px clamp(16px,2vw,24px);font-size:13.5px;color:var(--ink)"
                  >
                    <span>{item.q}</span>
                    <span style="color:var(--accent);font-size:16px;flex:none">{open.value === i ? '−' : '+'}</span>
                  </button>
                  {open.value === i && (
                    <p style="margin:0;padding:0 clamp(16px,2vw,24px) 22px;font-size:12.5px;line-height:1.75;color:var(--muted);max-width:76ch;text-wrap:pretty">
                      {item.a}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ),
        }}
      </Section>
    )
  },
})
