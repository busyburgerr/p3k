/**
 * Минимальная проверка версии на диапазон — ровно столько, сколько нужно
 * для peer-зависимостей из npm-реестра, и без единой зависимости.
 *
 * Поддерживается: точная версия, `*`/`x`, `^`, `~`, сравнения `>= > <= <`,
 * `1.2.x`, объединение через `||` и пересечение через пробел.
 * Пререлизы (`1.0.0-beta.2`) сравниваются по своей тройке чисел без учёта
 * суффикса — для наших целей этого достаточно.
 *
 * Всё, что разобрать не удалось, даёт `null`, а не `false`: лучше промолчать,
 * чем сообщить о несуществующем конфликте.
 */

export type Triple = [number, number, number]

export function parseVersion(input: string): Triple | null {
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(input)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function compare(a: Triple, b: Triple): number {
  for (let i = 0; i < 3; i++) {
    const x = a[i] as number
    const y = b[i] as number
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** '1.2.x' / '1.x' / '1' → нижняя и верхняя (исключающая) границы. */
function fromPartial(raw: string): { min: Triple; max: Triple } | null {
  const parts = raw.split('.')
  if (parts.length > 3) return null
  const nums: number[] = []
  for (const p of parts) {
    if (p === 'x' || p === 'X' || p === '*') break
    if (!/^\d+$/.test(p)) return null
    nums.push(Number(p))
  }
  if (nums.length === 0) return null
  const [a = 0, b = 0, c = 0] = nums
  if (nums.length === 3) return { min: [a, b, c], max: [a, b, c + 1] }
  if (nums.length === 2) return { min: [a, b, 0], max: [a, b + 1, 0] }
  return { min: [a, 0, 0], max: [a + 1, 0, 0] }
}

/** Верхняя граница `^`: следующий значащий разряд, как в npm. */
function caretMax([a, b, c]: Triple): Triple {
  if (a > 0) return [a + 1, 0, 0]
  if (b > 0) return [0, b + 1, 0]
  return [0, 0, c + 1]
}

/** Одно условие диапазона. `null` — не разобрали. */
function satisfiesOne(v: Triple, raw: string): boolean | null {
  const part = raw.trim()
  if (part === '' || part === '*' || part === 'x' || part === 'X') return true

  const op = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(part)
  if (!op) return null
  const [, operator, rest = ''] = op

  if (part.startsWith('^') || part.startsWith('~')) {
    const base = parseVersion(part.slice(1))
    if (!base) return null
    const max = part.startsWith('^') ? caretMax(base) : ([base[0], base[1] + 1, 0] as Triple)
    return compare(v, base) >= 0 && compare(v, max) < 0
  }

  const exact = parseVersion(rest)
  if (!exact) {
    // Неполная версия: '18', '1.2', '1.2.x'. Оператор применяется к границе
    // диапазона, который она задаёт, — как это делает npm: '>18' это '>=19.0.0'.
    const range = fromPartial(rest)
    if (!range) return null
    switch (operator) {
      case '>=':
        return compare(v, range.min) >= 0
      case '<':
        return compare(v, range.min) < 0
      case '>':
        return compare(v, range.max) >= 0
      case '<=':
        return compare(v, range.max) < 0
      default:
        return compare(v, range.min) >= 0 && compare(v, range.max) < 0
    }
  }

  switch (operator) {
    case '>=':
      return compare(v, exact) >= 0
    case '<=':
      return compare(v, exact) <= 0
    case '>':
      return compare(v, exact) > 0
    case '<':
      return compare(v, exact) < 0
    default:
      return compare(v, exact) === 0
  }
}

/**
 * Удовлетворяет ли версия диапазону.
 * `null` — диапазон записан в форме, которую мы не разбираем.
 */
export function satisfies(version: string, range: string): boolean | null {
  const v = parseVersion(version)
  if (!v) return null
  if (range.trim() === '') return null

  let anyUnion = false
  for (const union of range.split('||')) {
    const parts = union.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) continue

    let all = true
    for (const part of parts) {
      const res = satisfiesOne(v, part)
      if (res === null) return null
      if (!res) {
        all = false
        break
      }
    }
    anyUnion = true
    if (all) return true
  }
  return anyUnion ? false : null
}
