import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Кэш результатов проверок.
 *
 * Ключ — содержимое объявленных входов, а не время их изменения: после
 * `git checkout` или пересохранения файла mtime меняется, а содержимое нет, и
 * кэш по времени сбрасывался бы впустую.
 *
 * Запоминаем только успех. Проваленную проверку нужно перезапускать всегда:
 * её причина часто снаружи входов — недоступная сеть, чужой процесс, порт.
 */

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.test-build', '.cache'])
const MAX_FILES = 20_000

function walk(path: string, hash: ReturnType<typeof createHash>, budget: { left: number }) {
  if (budget.left <= 0) return
  let st
  try {
    st = statSync(path)
  } catch {
    // Отсутствие файла — тоже состояние входов, и оно должно менять ключ.
    hash.update('\0missing\0' + path)
    return
  }

  if (st.isFile()) {
    budget.left--
    hash.update('\0file\0' + path + '\0')
    try {
      hash.update(readFileSync(path))
    } catch {
      hash.update('unreadable')
    }
    return
  }

  if (!st.isDirectory()) return
  let entries: string[]
  try {
    entries = readdirSync(path).sort()
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    walk(join(path, entry), hash, budget)
  }
}

/**
 * Отпечаток входов проверки. `null` — входы не объявлены, кэшировать нельзя:
 * без списка входов мы не знаем, от чего результат зависит.
 */
export function fingerprint(root: string, inputs: string[], salt: string): string | null {
  if (inputs.length === 0) return null
  const hash = createHash('sha256')
  // Соль — сама команда: изменили её, и прошлый результат больше не про неё.
  hash.update(salt + '\0')
  const budget = { left: MAX_FILES }
  for (const input of [...inputs].sort()) {
    hash.update('\0input\0' + input + '\0')
    walk(join(root, input), hash, budget)
  }
  if (budget.left <= 0) return null
  return hash.digest('hex').slice(0, 32)
}

type Store = Record<string, string>

function cacheFile(root: string): string {
  const base = existsSync(join(root, 'node_modules'))
    ? join(root, 'node_modules', '.cache', 'p3k')
    : join(root, '.p3k')
  return join(base, 'check.json')
}

export function readCache(root: string): Store {
  try {
    const raw = JSON.parse(readFileSync(cacheFile(root), 'utf8')) as unknown
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Store) : {}
  } catch {
    return {}
  }
}

export function writeCache(root: string, store: Store): void {
  const file = cacheFile(root)
  try {
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify(store, null, 2), 'utf8')
  } catch {
    // Кэш — ускорение, а не результат. Не смогли записать — молча работаем без него.
  }
}
