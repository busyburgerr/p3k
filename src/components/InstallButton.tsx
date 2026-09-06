import { defineComponent } from 'vue'
import { useCopy } from '@/composables/useCopy'

export default defineComponent({
  name: 'InstallButton',
  props: { big: { type: Boolean, default: false } },
  setup(props) {
    const { state, copy } = useCopy('npm i -g @busyburger/p3k')
    return () => (
      <button
        class="pill solid"
        style={{ gap: '14px', padding: props.big ? '15px 24px' : '14px 22px', fontSize: '13px' }}
        onClick={copy}
      >
        <span>npm i -g @busyburger/p3k</span>
        <span style="opacity:.6;font-size:11px;letter-spacing:.1em">{state.value}</span>
      </button>
    )
  },
})
