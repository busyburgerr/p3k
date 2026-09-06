import type { Check, Finding } from '../../types.js'
import { satisfies } from '../../util/semver.js'

/** Требование к Node: из engines проекта, иначе — минимум, на котором мы сами живём. */
const FALLBACK = '>=18'

export const nodeCheck: Check = {
  id: 'runtime/node',
  group: 'РАНТАЙМЫ',
  async run(ctx): Promise<Finding[]> {
    const engines = (ctx.pkg?.engines ?? {}) as Record<string, string>
    const declared = typeof engines.node === 'string' ? engines.node : null
    const range = declared ?? FALLBACK
    const current = process.versions.node
    const ok = satisfies(current, range)

    const source = declared ? 'package.json → engines.node' : 'минимум по умолчанию'

    if (ok === null) {
      return [{
        level: 'skip',
        title: `Node ${current}`,
        detail: `не разобрали диапазон "${range}" (${source}) — проверка пропущена`,
      }]
    }
    if (ok) {
      return [{ level: 'ok', title: `Node ${current}`, detail: `требуется ${range} · ${source}` }]
    }
    // Для подсказки хватает старшего числа из диапазона: '>=18', '^20.1.0', '18.x'.
    const major = /(\d+)/.exec(range)?.[1]
    return [{
      level: 'fail',
      title: `Node ${current} не подходит`,
      detail: `требуется ${range} · ${source}`,
      fix: major ? `nvm install ${major} && nvm use ${major}` : 'обновите Node до требуемой версии',
    }]
  },
}
