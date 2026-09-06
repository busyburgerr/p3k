import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const CONFIG_NAMES = ['p3k.json', 'p3k.config.json']

export class ConfigError extends Error {}

export function findConfig(root: string): string | null {
  for (const name of CONFIG_NAMES) {
    const file = join(root, name)
    if (existsSync(file)) return file
  }
  return null
}

/**
 * Читаем конфиг как данные, а не как код.
 *
 * Формат намеренно JSON: исполнять пользовательский TypeScript пришлось бы
 * через сборщик, а это зависимость и целый класс ошибок ради удобства записи.
 */
export function readConfigJson(file: string): Record<string, unknown> {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (e) {
    throw new ConfigError(`${file}: не прочитали файл — ${e instanceof Error ? e.message : String(e)}`)
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new ConfigError(`${file}: не разобрали JSON — ${e instanceof Error ? e.message : String(e)}`)
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ConfigError(`${file}: на верхнем уровне ожидался объект`)
  }
  return raw as Record<string, unknown>
}

export function asRecord(v: unknown, where: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new ConfigError(`${where}: ожидался объект`)
  }
  return v as Record<string, unknown>
}
