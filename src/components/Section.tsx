import { defineComponent, type SlotsType } from 'vue'
import { useReveal } from '@/composables/useReveal'

/**
 * Каркас секции: обёртки, заголовок и подключение к скролл-наблюдателю.
 *
 * Секция сама регистрирует свой корень и отдаёт детям готовый data-shown через
 * слот — родителю не нужно ни знать её id, ни прокидывать флаг пропсом.
 * Слот kicker перекрывает одноимённый проп, когда справа от заголовка нужна
 * не подпись, а разметка (переключатели, счётчики).
 */
export default defineComponent({
  name: 'Section',
  props: {
    id: String,
    title: String,
    kicker: String,
    sectionStyle: String,
    wrapStyle: String,
    headStyle: String,
  },
  slots: Object as SlotsType<{
    default: (p: { shown?: string }) => unknown
    kicker?: () => unknown
  }>,
  setup(props, { slots }) {
    const { el, attr } = useReveal()

    return () => {
      const head = props.title || props.kicker || slots.kicker
      return (
        <section ref={el} id={props.id} class="section" style={props.sectionStyle}>
          <div class="wrap" style={props.wrapStyle}>
            {head && (
              <div class="head" style={props.headStyle}>
                {props.title && <h2 class="h2">{props.title}</h2>}
                {slots.kicker ? slots.kicker() : props.kicker && <div class="kicker">{props.kicker}</div>}
              </div>
            )}
            {slots.default?.({ shown: attr() })}
          </div>
        </section>
      )
    }
  },
})
