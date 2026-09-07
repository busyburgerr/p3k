import { findResource, type Resource, type ResourceOpts } from './resources.js'

export class AddError extends Error {}

/**
 * Запись о ресурсе в конфиге.
 *
 * Она нужна не для запуска — `dev` про эту секцию ничего не знает и читает
 * только `processes`. Она нужна, чтобы отличать процессы, которые добавил
 * инструмент, от процессов самого проекта: без этого нельзя ни привязать
 * следующий ресурс к приложению, ни собрать потом продакшен-манифест.
 */
export interface ResourceRecord {
  type: string
  ports: Record<string, number>
}

export interface AddPlan {
  resource: Resource
  name: string
  container: string
  ports: Record<string, number>
  /** Конфиг целиком, каким он станет. Исходный объект не меняется. */
  config: Record<string, unknown>
  /** Переменные, которые ресурс даёт приложению. */
  env: Record<string, string>
  /** Файлы, которые нужно положить рядом с конфигом. */
  files: Record<string, string>
  /** Процесс, к которому привязали ресурс, — или null, если привязывать не к чему. */
  linked: string | null
  /** Что привязка реально изменила: остальное у процесса уже было. */
  applied: { env: string[]; kept: string[]; needs: boolean }
  /** Процессы проекта, годные для привязки: показываем, когда выбор неоднозначен. */
  candidates: string[]
}

export interface AddInput {
  /** Разобранный конфиг проекта или null, если файла ещё нет. */
  config: Record<string, unknown> | null
  resource: string
  project: string
  name?: string
  /** Переопределения портов: 'port' → 5433. */
  ports?: Record<string, number>
  /**
   * К какому процессу привязать переменные и порядок запуска.
   * 'auto' — выбрать сам, если кандидат ровно один; null — не привязывать.
   */
  link?: string | 'auto' | null
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Разбор --port: '5433' или 'web=3001'. */
export function parsePortArg(raw: string, resource: Resource): [string, number] {
  const eq = raw.indexOf('=')
  const id = eq === -1 ? (resource.ports[0]?.id ?? 'port') : raw.slice(0, eq)
  const value = Number(eq === -1 ? raw : raw.slice(eq + 1))

  if (!resource.ports.some((p) => p.id === id)) {
    const known = resource.ports.map((p) => p.id).join(', ')
    throw new AddError(`у ресурса "${resource.id}" нет порта "${id}" — есть: ${known}`)
  }
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new AddError(`--port ${raw}: номер порта должен быть числом от 1 до 65535`)
  }
  return [id, value]
}

/**
 * Порты, которые конфиг уже занимает.
 *
 * Команды разбираются текстом: исполнять их ради номера порта нельзя, а
 * пробросы docker выглядят достаточно единообразно, чтобы их узнать. Что не
 * найдётся — не найдётся; проверка занятости на самой машине идёт отдельно и
 * ловит остальное.
 */
export function usedPorts(config: Record<string, unknown> | null): Map<number, string> {
  const used = new Map<number, string>()
  const procs = config && isRecord(config.processes) ? config.processes : {}

  for (const [name, raw] of Object.entries(procs)) {
    if (!isRecord(raw)) continue
    if (typeof raw.command === 'string') {
      for (const m of raw.command.matchAll(/-p\s+(?:[\d.]+:)?(\d+):\d+/g)) {
        const port = Number(m[1])
        if (!used.has(port)) used.set(port, name)
      }
    }
    if (isRecord(raw.ready) && typeof raw.ready.port === 'number' && !used.has(raw.ready.port)) {
      used.set(raw.ready.port, name)
    }
  }
  return used
}

export function readResources(config: Record<string, unknown> | null): Record<string, ResourceRecord> {
  const raw = config && isRecord(config.resources) ? config.resources : {}
  const out: Record<string, ResourceRecord> = {}
  for (const [name, value] of Object.entries(raw)) {
    if (!isRecord(value) || typeof value.type !== 'string') continue
    const ports: Record<string, number> = {}
    if (isRecord(value.ports)) {
      for (const [id, n] of Object.entries(value.ports)) if (typeof n === 'number') ports[id] = n
    }
    out[name] = { type: value.type, ports }
  }
  return out
}

export function planAdd(input: AddInput): AddPlan {
  const resource = findResource(input.resource)
  if (!resource) throw new AddError(`нет ресурса "${input.resource}"`)

  const name = input.name ?? resource.id
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) {
    throw new AddError(`имя "${name}": ожидались латиница, цифры и дефис`)
  }

  const config: Record<string, unknown> = input.config
    ? (JSON.parse(JSON.stringify(input.config)) as Record<string, unknown>)
    : {}
  if (!isRecord(config.processes)) config.processes = {}
  const processes = config.processes as Record<string, unknown>
  const resources = readResources(config)

  if (name in processes) {
    const what = name in resources ? `ресурс "${resources[name]?.type}"` : 'процесс проекта'
    throw new AddError(`в конфиге уже есть "${name}" — это ${what}; задайте другое имя через --name`)
  }

  const ports: Record<string, number> = {}
  for (const spec of resource.ports) ports[spec.id] = input.ports?.[spec.id] ?? spec.port

  const taken = usedPorts(config)
  for (const spec of resource.ports) {
    // Порт, по которому ресурс только ходит, занят чужим приложением по
    // определению: апстрим прокси — это и есть процесс проекта.
    if (!spec.bind) continue
    const chosen = ports[spec.id] as number
    const owner = taken.get(chosen)
    if (owner !== undefined) {
      throw new AddError(
        `порт ${chosen} (${spec.what}) уже занят процессом "${owner}" в этом же конфиге — ` +
          `возьмите другой: --port ${spec.id}=${chosen + 1}`,
      )
    }
  }

  const opts: ResourceOpts = {
    name,
    container: `${input.project}-${name}`,
    project: input.project,
    ports,
  }

  processes[name] = resource.process(opts)
  config.resources = { ...readResourcesRaw(config), [name]: { type: resource.id, ports } }

  const env = resource.env(opts)

  /*
   * Кандидаты на привязку — процессы самого проекта, не ресурсы.
   *
   * Разовые шаги отсеиваем: сборка и миграции живут секунды и переменные базы
   * им обычно не нужны, а приложение в проекте чаще всего одно. Если после
   * отсева остался ровно один — он и есть приложение; если нет, выбирать за
   * человека мы не беремся и просим --link.
   */
  const candidates = Object.keys(processes).filter((p) => p !== name && !(p in resources))
  const lasting = candidates.filter((p) => {
    const raw = processes[p]
    return !(isRecord(raw) && raw.oneShot === true)
  })
  const choice = lasting.length === 1 ? lasting : candidates

  let linked: string | null = null
  if (typeof input.link === 'string' && input.link !== 'auto') {
    if (!(input.link in processes) || input.link === name) {
      throw new AddError(`--link ${input.link}: такого процесса в конфиге нет`)
    }
    linked = input.link
  } else if (input.link === 'auto' && choice.length === 1) {
    linked = choice[0] as string
  }

  const applied = { env: [] as string[], kept: [] as string[], needs: false }

  if (linked) {
    const target = processes[linked]
    if (!isRecord(target)) throw new AddError(`процесс "${linked}" описан не объектом`)

    // Существующие значения не трогаем: человек мог поправить их осознанно, и
    // молча вернуть своё было бы хуже, чем не сделать ничего. Но и промолчать
    // нельзя — иначе второй такой же ресурс окажется никому не виден.
    const existing = isRecord(target.env) ? (target.env as Record<string, unknown>) : {}
    for (const key of Object.keys(env)) (key in existing ? applied.kept : applied.env).push(key)
    target.env = { ...env, ...existing }

    const needs = Array.isArray(target.needs) ? (target.needs as unknown[]) : []
    if (!needs.includes(name)) {
      target.needs = [...needs, name]
      applied.needs = true
    }
  }

  return {
    resource,
    name,
    container: opts.container,
    ports,
    config,
    env,
    files: resource.files?.(opts) ?? {},
    linked,
    applied,
    candidates: choice,
  }
}

/** Секция resources как есть — чтобы не потерять поля, которых мы не знаем. */
function readResourcesRaw(config: Record<string, unknown>): Record<string, unknown> {
  return isRecord(config.resources) ? (config.resources as Record<string, unknown>) : {}
}

/**
 * Дописать переменные в .env.example.
 *
 * Существующие ключи не трогаем и не переставляем: файл ведёт человек, а мы в
 * него только дописываем. Возвращается null, если дописывать нечего.
 */
export function mergeEnvExample(text: string, title: string, vars: Record<string, string>): string | null {
  const have = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)
    if (m?.[1]) have.add(m[1])
  }

  const missing = Object.entries(vars).filter(([k]) => !have.has(k))
  if (missing.length === 0) return null

  const block = [`# ${title}`, ...missing.map(([k, v]) => `${k}=${v}`)].join('\n')
  if (text.trim() === '') return `${block}\n`
  return `${text.replace(/\s*$/, '')}\n\n${block}\n`
}
