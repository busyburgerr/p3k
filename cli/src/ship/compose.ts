import { RESOURCES } from '../add/resources.js'
import type { ResourceRecord } from '../add/plan.js'
import type { ProdForm } from '../add/resources.js'

/**
 * Продакшен-половина ресурсов.
 *
 * Локально ресурсы — это команды docker run в конфиге; на сервере — службы в
 * одном compose-файле. Описание при этом одно: и то и другое собирается из
 * секции resources, которую написала команда add. Поэтому база в проде — та же
 * база, что на ноутбуке, а не её пересказ по памяти.
 */

/**
 * Минимальный вывод YAML.
 *
 * Полноценная библиотека здесь не нужна: мы печатаем свою же структуру, а не
 * разбираем чужую. Строки всегда в двойных кавычках — так не нужно гадать,
 * какие из них YAML примет за число, дату или значение вроде no.
 */
export function toYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)

  if (Array.isArray(value)) {
    if (value.length === 0) return ' []\n'
    return '\n' + value.map((v) => `${pad}- ${toYaml(v, indent + 1).trimStart()}`).join('')
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return ' {}\n'
    return '\n' + entries.map(([k, v]) => `${pad}${k}:${toYaml(v, indent + 1)}`).join('')
  }

  if (typeof value === 'string') return ` "${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\n`
  return ` ${String(value)}\n`
}

export interface ComposePlan {
  yaml: string
  /** Файлы, которые едут в shared/ рядом с compose. */
  files: Record<string, string>
  /** Что должно оказаться в shared/.env на сервере. */
  env: Record<string, string>
  /** Ресурсы, которым в проде не место: mailpit и подобные. */
  skipped: string[]
  /** Имена служб в compose. */
  services: string[]
}

/**
 * Собрать compose из реестра ресурсов проекта.
 *
 * Ресурсы, которых нет в каталоге, пропускаются молча: конфиг мог быть написан
 * более новой версией инструмента, и падать из-за этого нельзя.
 */
export function planCompose(resources: Record<string, ResourceRecord>, project: string): ComposePlan | null {
  const services: Record<string, unknown> = {}
  const volumes: Record<string, unknown> = {}
  const files: Record<string, string> = {}
  const env: Record<string, string> = {}
  const skipped: string[] = []

  for (const [name, record] of Object.entries(resources)) {
    const resource = RESOURCES.find((r) => r.id === record.type)
    if (!resource) continue
    if (!resource.prod) {
      skipped.push(`${name} (${resource.title})`)
      continue
    }

    const form: ProdForm = resource.prod({
      name,
      container: `${project}-${name}`,
      project,
      ports: record.ports,
    })

    services[name] = form.service
    for (const v of form.volumes) volumes[v] = null
    Object.assign(env, form.env)
    Object.assign(files, form.files ?? {})
  }

  if (Object.keys(services).length === 0) return null

  const doc: Record<string, unknown> = { services }
  if (Object.keys(volumes).length > 0) doc.volumes = volumes

  const header =
    '# Собрано командой p3k ship из секции resources в p3k.json.\n' +
    '# Правки здесь потеряются при следующей выкатке — правьте конфиг проекта.\n' +
    '# Пароли берутся из shared/.env рядом с этим файлом и сюда не попадают.\n'

  return { yaml: header + toYaml(doc).trimStart(), files, env, skipped, services: Object.keys(services) }
}

/** Заготовка shared/.env: значения в угловых скобках человек заполняет сам. */
export function envExample(env: Record<string, string>): string {
  const lines = [
    '# Переменные окружения продакшена. Файл остаётся на сервере и никуда',
    '# не отправляется. Значения в угловых скобках замените своими.',
    '',
  ]
  for (const [key, value] of Object.entries(env)) lines.push(`${key}=${value}`)
  return lines.join('\n') + '\n'
}

/** Переменные, которые человек ещё не заполнил. */
export const unfilled = (env: Record<string, string>) =>
  Object.entries(env)
    .filter(([, v]) => v.includes('<'))
    .map(([k]) => k)
