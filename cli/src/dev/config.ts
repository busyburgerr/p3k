import { asRecord, ConfigError, findConfig, readConfigJson, CONFIG_NAMES } from '../config.js'

export { ConfigError, findConfig, CONFIG_NAMES }

/**
 * Готовность процесса — условие, после которого можно запускать зависящих от него.
 *
 * `port` — сокет принимает соединение. Дёшево, но врёт на службах, которые
 *          открывают порт раньше, чем готовы обслуживать: Postgres принимает
 *          соединения ещё во время инициализации кластера.
 * `http` — ответ по URL со статусом ниже 500. Проверяет, что служба отвечает
 *          по делу, а не просто слушает.
 * `exec` — команда завершилась успешно. Единственный честный способ для баз:
 *          `docker exec app-db pg_isready -U postgres`.
 * `log`  — строка в выводе: для того, что не слушает порт (сборщики, воркеры).
 * `delay`— признание поражения; оставлен, потому что иногда другого способа нет.
 * Без `ready` процесс считается готовым сразу после старта.
 */
export type Ready =
  | { port: number }
  | { http: string; status?: number }
  | { exec: string }
  | { log: string }
  | { delay: number }

export interface ProcessSpec {
  name: string
  command: string
  cwd?: string
  env?: Record<string, string>
  /** Имена процессов, которые должны быть готовы раньше этого. */
  needs: string[]
  ready?: Ready
  /**
   * Процесс должен отработать и завершиться, а не жить всё время сессии:
   * миграции, кодогенерация, ожидание чужого сервиса.
   *
   * Для такого готовность — это успешный выход, а не открытый порт, и его
   * завершение не считается поводом гасить окружение.
   */
  oneShot: boolean
  /** Команда корректной остановки — для того, что переживает смерть родителя (контейнеры). */
  stop?: string
}

export interface DevConfig {
  root: string
  file: string
  processes: ProcessSpec[]
}

function parseReady(raw: unknown, where: string): Ready | undefined {
  if (raw === undefined) return undefined
  const r = asRecord(raw, where)
  if (typeof r.port === 'number') return { port: r.port }
  if (typeof r.http === 'string') {
    if (!/^https?:\/\//.test(r.http)) throw new ConfigError(`${where}.http: ожидался URL со схемой http или https`)
    if (r.status !== undefined && typeof r.status !== 'number') {
      throw new ConfigError(`${where}.status: ожидалось число`)
    }
    return typeof r.status === 'number' ? { http: r.http, status: r.status } : { http: r.http }
  }
  if (typeof r.exec === 'string') {
    if (r.exec.trim() === '') throw new ConfigError(`${where}.exec: пустая строка`)
    return { exec: r.exec }
  }
  if (typeof r.log === 'string') return { log: r.log }
  if (typeof r.delay === 'number') return { delay: r.delay }
  throw new ConfigError(`${where}: ожидалось одно из { port } | { http } | { exec } | { log } | { delay }`)
}

function parseEnv(raw: unknown, where: string): Record<string, string> | undefined {
  if (raw === undefined) return undefined
  const r = asRecord(raw, where)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(r)) {
    if (typeof v !== 'string' && typeof v !== 'number') {
      throw new ConfigError(`${where}.${k}: значение должно быть строкой или числом`)
    }
    out[k] = String(v)
  }
  return out
}

export function loadConfig(root: string, file: string): DevConfig {
  const top = readConfigJson(file)
  const procs = asRecord(top.processes ?? {}, `${file} → processes`)
  const names = Object.keys(procs)
  if (names.length === 0) throw new ConfigError(`${file}: в processes нет ни одного процесса`)

  const processes: ProcessSpec[] = names.map((name) => {
    const where = `${file} → processes.${name}`
    const p = asRecord(procs[name], where)
    if (typeof p.command !== 'string' || p.command.trim() === '') {
      throw new ConfigError(`${where}.command: обязательная непустая строка`)
    }
    const needsRaw = p.needs ?? []
    if (!Array.isArray(needsRaw) || needsRaw.some((n) => typeof n !== 'string')) {
      throw new ConfigError(`${where}.needs: ожидался массив строк`)
    }
    return {
      name,
      command: p.command,
      cwd: typeof p.cwd === 'string' ? p.cwd : undefined,
      env: parseEnv(p.env, `${where}.env`),
      needs: needsRaw as string[],
      oneShot: p.oneShot === true,
      ready: parseReady(p.ready, `${where}.ready`),
      stop: typeof p.stop === 'string' ? p.stop : undefined,
    }
  })

  const known = new Set(names)
  for (const p of processes) {
    for (const n of p.needs) {
      if (!known.has(n)) throw new ConfigError(`${file} → processes.${p.name}.needs: нет процесса "${n}"`)
      if (n === p.name) throw new ConfigError(`${file} → processes.${p.name}.needs: процесс зависит сам от себя`)
    }
  }

  return { root, file, processes }
}
