import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Check, Finding } from '../../types.js'
import { readJson } from '../../util/project.js'
import { satisfies } from '../../util/semver.js'
import { plural } from '../../util/plural.js'

interface Conflict {
  pkg: string
  pkgVersion: string
  peer: string
  wanted: string
  installed: string
}

/** Плоский список установленных пакетов верхнего уровня, включая @scope/name. */
function installedPackages(modules: string): string[] {
  let entries: string[] = []
  try {
    entries = readdirSync(modules)
  } catch {
    return []
  }
  const names: string[] = []
  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    if (entry.startsWith('@')) {
      try {
        for (const sub of readdirSync(join(modules, entry))) names.push(`${entry}/${sub}`)
      } catch {
        /* нечитаемый каталог области имён пропускаем */
      }
      continue
    }
    names.push(entry)
  }
  return names
}

/**
 * Нарушенные peer-зависимости.
 *
 * Дерево, собранное когда-то давно, продолжает работать, даже если пакет
 * объявляет несовместимый peer, — поэтому такой конфликт незаметен ровно до
 * первой установки с нуля, где npm откажется ставить вообще всё.
 *
 * Сообщаем только о случаях «peer установлен, но версия вне диапазона»:
 * отсутствующий peer чаще всего означает намеренный отказ, а не поломку,
 * и ругаться на него — верный способ приучить пролистывать вывод.
 */
export const peersCheck: Check = {
  id: 'deps/peers',
  group: 'ЗАВИСИМОСТИ',
  async run(ctx): Promise<Finding[]> {
    const modules = join(ctx.root, 'node_modules')
    if (!existsSync(modules)) return []

    const names = installedPackages(modules)
    if (names.length === 0) return []

    const versionOf = (name: string): string | null => {
      const meta = readJson(join(modules, name, 'package.json'))
      return typeof meta?.version === 'string' ? meta.version : null
    }

    const conflicts: Conflict[] = []
    let unparsed = 0

    for (const name of names) {
      const meta = readJson(join(modules, name, 'package.json'))
      if (!meta) continue
      const peers = (meta.peerDependencies ?? {}) as Record<string, string>
      const optional = (meta.peerDependenciesMeta ?? {}) as Record<string, { optional?: boolean }>

      for (const [peer, wanted] of Object.entries(peers)) {
        if (typeof wanted !== 'string') continue
        if (optional[peer]?.optional) continue
        // Вложенная копия перекрывает верхнеуровневую — тогда конфликта нет.
        if (existsSync(join(modules, name, 'node_modules', peer))) continue

        const installed = versionOf(peer)
        if (!installed) continue

        const ok = satisfies(installed, wanted)
        if (ok === null) {
          unparsed++
          continue
        }
        if (!ok) {
          conflicts.push({
            pkg: name,
            pkgVersion: typeof meta.version === 'string' ? meta.version : '?',
            peer,
            wanted,
            installed,
          })
        }
      }
    }

    if (conflicts.length === 0) {
      const scanned = plural(names.length, 'пакет', 'пакета', 'пакетов')
      const note = unparsed > 0
        ? `${scanned}, ${plural(unparsed, 'диапазон пропущен', 'диапазона пропущено', 'диапазонов пропущено')} как неразобранный`
        : scanned
      return [{ level: 'ok', title: 'peer-зависимости согласованы', detail: note }]
    }

    return conflicts.map((c) => ({
      level: 'warn' as const,
      title: `${c.pkg}@${c.pkgVersion} требует ${c.peer} ${c.wanted}`,
      detail: [
        `установлен ${c.peer}@${c.installed}`,
        'текущее дерево работает, но npm install с нуля упадёт с ERESOLVE',
      ].join('\n'),
      fix: `npm i -D ${c.pkg}@latest`,
    }))
  },
}
