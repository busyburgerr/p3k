export class CycleError extends Error {}

export interface Node {
  name: string
  /** Имена узлов, которые должны быть выполнены раньше этого. */
  needs: string[]
}

/**
 * Порядок выполнения: волнами, а не по одному.
 *
 * Каждая волна — узлы, все зависимости которых уже пройдены; внутри волны они
 * идут параллельно. Заметно быстрее строгой цепочки и при этом сохраняет
 * гарантию: к моменту старта узла всё, чего он ждёт, уже готово.
 */
export function waves<T extends Node>(nodes: T[]): T[][] {
  const byName = new Map(nodes.map((n) => [n.name, n]))
  const pending = new Set(byName.keys())
  const done = new Set<string>()
  const out: T[][] = []

  while (pending.size > 0) {
    const wave = [...pending].filter((name) => byName.get(name)?.needs.every((n) => done.has(n)) ?? false)

    if (wave.length === 0) {
      // Ни один из оставшихся не может стартовать — значит, они держат друг друга.
      throw new CycleError(`циклическая зависимость: ${[...pending].sort().join(', ')}`)
    }

    out.push(wave.map((name) => byName.get(name) as T))
    for (const name of wave) {
      pending.delete(name)
      done.add(name)
    }
  }
  return out
}

/** Проверка, что все ссылки в needs указывают на существующие узлы. */
export function unknownNeeds(nodes: Node[]): { name: string; missing: string }[] {
  const known = new Set(nodes.map((n) => n.name))
  const bad: { name: string; missing: string }[] = []
  for (const n of nodes) {
    for (const need of n.needs) {
      if (!known.has(need)) bad.push({ name: n.name, missing: need })
    }
  }
  return bad
}
