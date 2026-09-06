import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Check, Finding } from '../../types.js'
import { envKeys } from '../../util/project.js'
import { plural } from '../../util/plural.js'

const SAMPLES = ['.env.example', '.env.sample', '.env.template']
const LOCALS = ['.env', '.env.local']

/**
 * Сравниваем объявленные переменные с фактически доступными.
 * Значения не читаются и никуда не попадают — только имена ключей.
 */
export const envCheck: Check = {
  id: 'env',
  group: 'ОКРУЖЕНИЕ',
  async run(ctx): Promise<Finding[]> {
    const sample = SAMPLES.map((f) => join(ctx.root, f)).find(existsSync)
    if (!sample) {
      return [{ level: 'skip', title: 'переменные окружения', detail: 'в проекте нет .env.example — сверять не с чем' }]
    }

    const declared = envKeys(sample)
    if (declared.length === 0) {
      return [{ level: 'skip', title: 'переменные окружения', detail: `${sample} не содержит ключей` }]
    }

    const available = new Set<string>(Object.keys(process.env))
    const localFiles: string[] = []
    for (const name of LOCALS) {
      const file = join(ctx.root, name)
      if (!existsSync(file)) continue
      localFiles.push(name)
      for (const k of envKeys(file)) available.add(k)
    }

    const missing = declared.filter((k) => !available.has(k))
    const from = localFiles.length ? `${localFiles.join(', ')} и окружение процесса` : 'окружение процесса'

    if (missing.length === 0) {
      return [{ level: 'ok', title: `${plural(declared.length, 'переменная', 'переменные', 'переменных')} на месте`, detail: `сверено с ${from}` }]
    }

    return [{
      level: 'fail',
      title: `не задано переменных: ${missing.length}`,
      detail: [`объявлены в ${SAMPLES.find((f) => sample.endsWith(f))}, не найдены в ${from}:`, ...missing.map((k) => `  ${k}`)].join('\n'),
      fix: localFiles.length ? 'допишите недостающие ключи в .env' : `cp ${SAMPLES.find((f) => sample.endsWith(f))} .env`,
    }]
  },
}
