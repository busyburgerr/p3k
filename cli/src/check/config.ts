import { join } from 'node:path'
import { asRecord, ConfigError, readConfigJson } from '../config.js'
import { readJson } from '../util/project.js'
import { unknownNeeds } from '../util/graph.js'
import { parseSize } from './size.js'

interface Common {
  name: string
  /** Проверки, которые должны пройти раньше этой: бюджет размера ждёт сборку. */
  needs: string[]
  optional: boolean
  /**
   * Файлы и каталоги, от которых зависит результат. Пока они не менялись,
   * успешный результат берётся из кэша. Пустой список — не кэшировать:
   * не зная входов, мы не вправе утверждать, что ничего не изменилось.
   */
  inputs: string[]
}

export type Gate =
  | (Common & { kind: 'command'; command: string; cwd?: string })
  | (Common & { kind: 'size'; path: string; max: number; gzip: boolean })

export interface CheckPlan {
  gates: Gate[]
  /** Откуда взялись проверки — показываем, чтобы вывод можно было перепроверить. */
  source: string
}

/**
 * Скрипты, которые считаем проверками, если в конфиге ничего не сказано.
 *
 * Порядок — от быстрого к медленному: типы падают за секунды и чаще всего,
 * тесты идут минуты. `build` сюда не входит намеренно: у него побочные эффекты,
 * и он обычно уже выполняется внутри тестов.
 */
const INFERRED = ['typecheck', 'types', 'lint', 'test']

function parseGate(name: string, raw: unknown, where: string): Gate {
  const g = asRecord(raw, where)
  const optional = g.optional === true
  const needsRaw = g.needs ?? []
  if (!Array.isArray(needsRaw) || needsRaw.some((n) => typeof n !== 'string')) {
    throw new ConfigError(`${where}.needs: ожидался массив строк`)
  }
  const needs = needsRaw as string[]
  const inputsRaw = g.inputs ?? []
  if (!Array.isArray(inputsRaw) || inputsRaw.some((n) => typeof n !== 'string')) {
    throw new ConfigError(`${where}.inputs: ожидался массив строк`)
  }
  const inputs = inputsRaw as string[]

  if (typeof g.command === 'string') {
    if (g.command.trim() === '') throw new ConfigError(`${where}.command: пустая строка`)
    return {
      name,
      kind: 'command',
      command: g.command,
      cwd: typeof g.cwd === 'string' ? g.cwd : undefined,
      needs,
      optional,
      inputs,
    }
  }

  if (g.size !== undefined) {
    const s = asRecord(g.size, `${where}.size`)
    if (typeof s.path !== 'string' || s.path.trim() === '') {
      throw new ConfigError(`${where}.size.path: обязательная непустая строка`)
    }
    if (s.max === undefined) throw new ConfigError(`${where}.size.max: обязательное поле, например "180kb"`)
    const max = parseSize(s.max as string | number)
    if (max === null) {
      throw new ConfigError(`${where}.size.max: не разобрали "${String(s.max)}" — ожидалось что-то вроде "180kb"`)
    }
    return { name, kind: 'size', path: s.path, max, gzip: s.gzip === true, needs, optional, inputs }
  }

  throw new ConfigError(`${where}: ожидалось одно из { command } | { size }`)
}

export function loadChecks(root: string, file: string | null): CheckPlan {
  if (file) {
    const top = readConfigJson(file)
    if (top.checks !== undefined) {
      const checks = asRecord(top.checks, `${file} → checks`)
      const names = Object.keys(checks)
      if (names.length === 0) throw new ConfigError(`${file} → checks: не описано ни одной проверки`)
      const gates = names.map((n) => parseGate(n, checks[n], `${file} → checks.${n}`))
      for (const bad of unknownNeeds(gates)) {
        throw new ConfigError(`${file} → checks.${bad.name}.needs: нет проверки "${bad.missing}"`)
      }
      return { gates, source: file }
    }
  }

  // Конфига нет или в нём нет checks — выводим проверки из скриптов проекта.
  const pkg = readJson(join(root, 'package.json'))
  const scripts = (pkg?.scripts ?? {}) as Record<string, string>
  const gates: Gate[] = INFERRED.filter((s) => typeof scripts[s] === 'string').map((s) => ({
    name: s,
    kind: 'command' as const,
    command: `npm run ${s}`,
    needs: [],
    optional: false,
    inputs: [],
  }))

  return { gates, source: 'выведено из package.json → scripts' }
}
