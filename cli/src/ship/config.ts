import { asRecord, ConfigError, readConfigJson } from '../config.js'

/**
 * Проверка здоровья после переключения.
 *
 * Без неё выкатка означала бы «файлы доехали», а не «приложение работает»:
 * ровно между этими двумя утверждениями и живут все ночные откаты.
 */
export interface Health {
  url: string
  /** Ожидаемый статус. Без него годится любой ниже 500. */
  status?: number
  /** Сколько секунд ждать, пока приложение поднимется после перезапуска. */
  timeout: number
}

export interface DeployConfig {
  /** user@host для SSH или null — тогда цель на этой же машине. */
  host: string | null
  /** Дополнительные аргументы ssh: порт, ключ. */
  ssh: string[]
  /** Корень выкатки на цели: внутри появятся releases/ и current. */
  path: string
  /** Команда сборки, выполняется локально до отправки. */
  build: string | null
  /** Что отправлять — пути относительно корня проекта. */
  upload: string[]
  /** Команда внутри нового выпуска до переключения: установка зависимостей, миграции. */
  release: string | null
  /** Команда после переключения: перезапуск службы. */
  restart: string | null
  health: Health | null
  /** Сколько прошлых выпусков хранить. Меньше двух откат невозможен. */
  keep: number
  /** Прогонять ли check перед выкаткой. */
  checks: boolean
  /** Поднимать ли на сервере ресурсы проекта — базу, кэш, прокси. */
  resources: boolean
}

function parseHealth(raw: unknown, where: string): Health | null {
  if (raw === undefined || raw === null) return null

  if (typeof raw === 'string') {
    if (!/^https?:\/\//.test(raw)) throw new ConfigError(`${where}: ожидался URL со схемой http или https`)
    return { url: raw, timeout: 60 }
  }

  const h = asRecord(raw, where)
  if (typeof h.url !== 'string' || !/^https?:\/\//.test(h.url)) {
    throw new ConfigError(`${where}.url: ожидался URL со схемой http или https`)
  }
  if (h.status !== undefined && typeof h.status !== 'number') {
    throw new ConfigError(`${where}.status: ожидалось число`)
  }
  if (h.timeout !== undefined && (typeof h.timeout !== 'number' || h.timeout <= 0)) {
    throw new ConfigError(`${where}.timeout: ожидались секунды числом больше нуля`)
  }
  return {
    url: h.url,
    ...(typeof h.status === 'number' ? { status: h.status } : {}),
    timeout: typeof h.timeout === 'number' ? h.timeout : 60,
  }
}

function strings(raw: unknown, where: string): string[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) {
    throw new ConfigError(`${where}: ожидался массив строк`)
  }
  return raw as string[]
}

const optionalString = (raw: unknown, where: string): string | null => {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string' || raw.trim() === '') throw new ConfigError(`${where}: ожидалась непустая строка`)
  return raw
}

export function parseDeploy(raw: unknown, where: string): DeployConfig {
  const d = asRecord(raw, where)

  const path = d.path
  if (typeof path !== 'string' || path.trim() === '') {
    throw new ConfigError(`${where}.path: обязательное поле — каталог выкатки на цели, например "/srv/app"`)
  }

  const upload = strings(d.upload, `${where}.upload`)
  if (upload.length === 0) {
    throw new ConfigError(`${where}.upload: обязательное поле — что отправлять, например ["dist", "package.json"]`)
  }
  for (const p of upload) {
    // Выход за пределы проекта — почти наверняка описка, а последствия у неё
    // на чужой машине и необратимые.
    if (p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:/.test(p) || p.split(/[\\/]/).includes('..')) {
      throw new ConfigError(`${where}.upload: "${p}" — ожидался путь внутри проекта`)
    }
  }

  if (d.keep !== undefined && (typeof d.keep !== 'number' || !Number.isInteger(d.keep) || d.keep < 2)) {
    throw new ConfigError(`${where}.keep: ожидалось целое не меньше 2 — иначе откатываться будет некуда`)
  }

  return {
    host: optionalString(d.host, `${where}.host`),
    ssh: strings(d.ssh, `${where}.ssh`),
    path,
    build: optionalString(d.build, `${where}.build`),
    upload,
    release: optionalString(d.release, `${where}.release`),
    restart: optionalString(d.restart, `${where}.restart`),
    health: parseHealth(d.health, `${where}.health`),
    keep: typeof d.keep === 'number' ? d.keep : 5,
    checks: d.checks !== false,
    resources: d.resources !== false,
  }
}

export function loadDeploy(file: string): DeployConfig {
  const top = readConfigJson(file)
  if (top.deploy === undefined) {
    throw new ConfigError(`${file}: нет секции deploy — описывать выкатку негде`)
  }
  return parseDeploy(top.deploy, `${file} → deploy`)
}

/** Имя выпуска: время в UTC, чтобы порядок по алфавиту совпадал с порядком по времени. */
export function releaseId(now = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`
  )
}

export const RELEASE_ID = /^\d{8}-\d{6}(?:-\d{2})?$/

/**
 * Имя, которого на цели ещё нет.
 *
 * Две выкатки в одну секунду — не выдумка: так выглядит повторный запуск после
 * опечатки. Без этого второй выпуск лёг бы поверх первого, и откатываться было
 * бы уже некуда. Порядковый номер дополняется нулём, чтобы имена продолжали
 * сортироваться по алфавиту так же, как по времени.
 */
export function uniqueRelease(taken: string[], base = releaseId()): string {
  if (!taken.includes(base)) return base
  for (let i = 2; i < 100; i++) {
    const id = `${base}-${String(i).padStart(2, '0')}`
    if (!taken.includes(id)) return id
  }
  throw new Error('сто выпусков за одну секунду — что-то пошло не так')
}
