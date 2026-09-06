import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { ConfigError, findConfig } from '../config.js'
import { CycleError, waves } from '../util/graph.js'
import { findRoot } from '../util/project.js'
import { loadChecks, type Gate } from './config.js'
import { fingerprint, readCache, writeCache } from './cache.js'
import { formatSize, measure } from './size.js'

export const CHECK_HELP = `
  p3k check — прогнать проверки проекта до того, как это сделает CI

  Использование:
    p3k check [каталог] [опции]

  Опции:
    --only <имя>  прогнать только эти проверки (можно повторять)
    --no-cache    прогнать всё заново, игнорируя кэш
    --list        показать проверки и выйти
    --json        машиночитаемый вывод
    --help        эта справка

  Проверки описываются в p3k.json:

    "checks": {
      "types":  { "command": "npm run typecheck" },
      "tests":  { "command": "npm test" },
      "bundle": { "size": { "path": "dist", "max": "180kb", "gzip": true } },
      "lint":   { "command": "npm run lint", "optional": true }
    }

  Поле inputs включает кэш: пока перечисленные файлы не менялись, успешный
  результат берётся из кэша, а проверка не запускается.

    "types": { "command": "npm run typecheck", "inputs": ["src", "tsconfig.json"] }

  Без секции checks проверки выводятся из scripts в package.json.
  Код возврата: 1, если хоть одна обязательная проверка не прошла.
`

const useColor = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)
const dim = (s: string) => paint('2', s)

interface Args {
  dir: string
  only: string[]
  list: boolean
  json: boolean
  cache: boolean
  help: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dir: process.cwd(), only: [], list: false, json: false, cache: true, help: false }
  let dirSeen = false

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') args.help = true
    else if (a === '--list') args.list = true
    else if (a === '--json') args.json = true
    else if (a === '--no-cache') args.cache = false
    else if (a === '--only') {
      const n = argv[++i]
      if (n) args.only.push(n)
    } else if (a && !a.startsWith('-') && !dirSeen) {
      args.dir = a
      dirSeen = true
    }
  }
  return args
}

type State = 'ok' | 'fail' | 'skip' | 'cached'

interface Result {
  name: string
  state: State
  optional: boolean
  ms: number
  /** Короткая строка справа от имени: размер, код выхода. */
  note: string
  /** Подробности — печатаются только когда проверка не прошла. */
  detail: string
}

function runCommand(root: string, gate: Gate & { kind: 'command' }): Promise<Result> {
  const started = Date.now()
  return new Promise((resolve) => {
    const child = spawn(gate.command, {
      cwd: gate.cwd ? join(root, gate.cwd) : root,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // Вывод копим, а не печатаем: проверки идут параллельно, и вперемешку
    // их логи нечитаемы. Показываем только у тех, кто не прошёл.
    let output = ''
    const collect = (b: Buffer) => {
      output += b.toString()
      if (output.length > 200_000) output = output.slice(-200_000)
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)

    const finish = (code: number, note: string) =>
      resolve({
        name: gate.name,
        state: code === 0 ? 'ok' : 'fail',
        optional: gate.optional,
        ms: Date.now() - started,
        note,
        detail: output.trimEnd(),
      })

    child.on('error', (e) => finish(1, `не запустилось: ${e.message}`))
    child.on('exit', (code, signal) => {
      const c = code ?? (signal ? 143 : 1)
      finish(c, c === 0 ? '' : `код ${c}`)
    })
  })
}

async function runSize(root: string, gate: Gate & { kind: 'size' }): Promise<Result> {
  const started = Date.now()
  const measured = measure(root, gate.path, gate.gzip)
  const base = { name: gate.name, optional: gate.optional, ms: Date.now() - started }

  if (!measured) {
    return {
      ...base,
      state: 'fail' as const,
      note: 'нечего мерить',
      detail: `${gate.path} не существует — соберите проект перед проверкой бюджета`,
    }
  }

  const unit = gate.gzip ? ' (gzip)' : ''
  const note = `${formatSize(measured.total)} из ${formatSize(gate.max)}${unit}`
  if (measured.total <= gate.max) return { ...base, state: 'ok' as const, note, detail: '' }

  const top = measured.files.slice(0, 5).map((f) => `  ${formatSize(f.bytes).padStart(9)}  ${f.path}`)
  return {
    ...base,
    state: 'fail' as const,
    note: `${note}, превышение ${formatSize(measured.total - gate.max)}`,
    detail: [`самое крупное в ${gate.path}:`, ...top].join('\n'),
  }
}

const run = (root: string, gate: Gate) =>
  gate.kind === 'command' ? runCommand(root, gate) : runSize(root, gate)

export async function runCheck(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  if (args.help) {
    process.stdout.write(CHECK_HELP)
    return 0
  }

  const root = findRoot(args.dir)
  const file = findConfig(root)

  let plan
  try {
    plan = loadChecks(root, file)
  } catch (e) {
    if (e instanceof ConfigError) {
      process.stderr.write(`check: ${e.message}\n`)
      return 2
    }
    throw e
  }

  let gates = plan.gates
  if (args.only.length > 0) {
    const known = new Set(gates.map((g) => g.name))
    const unknown = args.only.filter((n) => !known.has(n))
    if (unknown.length > 0) {
      process.stderr.write(`check: нет проверок: ${unknown.join(', ')}. Есть: ${[...known].join(', ')}\n`)
      return 2
    }
    // Как и в dev: берём названные проверки вместе со всем, от чего они зависят —
    // иначе "--only bundle" осталась бы без сборки, которую измеряет.
    const byName = new Map(gates.map((g) => [g.name, g]))
    const keep = new Set<string>()
    const visit = (n: string) => {
      if (keep.has(n)) return
      keep.add(n)
      byName.get(n)?.needs.forEach(visit)
    }
    args.only.forEach(visit)
    gates = gates.filter((g) => keep.has(g.name))
  }

  if (gates.length === 0) {
    process.stderr.write(
      'check: проверок не найдено\n' +
        '     опишите секцию checks в p3k.json или заведите скрипты test / lint / typecheck\n',
    )
    return 2
  }

  if (args.list) {
    process.stdout.write(`\n  Проверки (${plan.source}):\n`)
    for (const g of gates) {
      const what = g.kind === 'command' ? g.command : `размер ${g.path} ≤ ${formatSize(g.max)}${g.gzip ? ' (gzip)' : ''}`
      process.stdout.write(`    ${g.name}${g.optional ? ' (необязательная)' : ''} — ${what}\n`)
    }
    process.stdout.write('\n')
    return 0
  }

  let plannedWaves: Gate[][]
  try {
    plannedWaves = waves(gates)
  } catch (e) {
    if (e instanceof CycleError) {
      process.stderr.write(`check: ${e.message}\n`)
      return 2
    }
    throw e
  }

  const started = Date.now()
  const results: Result[] = []
  const passed = new Set<string>()
  const cache = args.cache ? readCache(root) : {}
  const fresh: Record<string, string> = {}
  if (!args.json) process.stdout.write(`\n  ${dim(plan.source)}\n\n`)

  const report = (r: Result) => {
    results.push(r)
    if (args.json) return
    const mark =
      r.state === 'ok'
        ? paint('32', '✓')
        : r.state === 'cached'
          ? paint('32', '✓')
          : r.state === 'skip'
            ? dim('·')
            : r.optional
              ? paint('33', '!')
              : paint('31', '✗')
    const note = r.note ? dim(` — ${r.note}`) : ''
    const time = r.state === 'skip' || r.state === 'cached' ? '' : dim(` · ${(r.ms / 1000).toFixed(1)}с`)
    process.stdout.write(`  ${mark}  ${r.state === 'skip' ? dim(r.name) : r.name}${note}${time}\n`)
  }

  // Волнами: внутри волны параллельно, следующая — только когда предыдущая
  // прошла. Бюджет размера обязан считаться после сборки, а не одновременно.
  for (const wave of plannedWaves) {
    const runnable = wave.filter((g) => g.needs.every((n) => passed.has(n)))
    const blocked = wave.filter((g) => !g.needs.every((n) => passed.has(n)))

    // Отпечаток считаем до запуска: команда может менять свои же входы
    // (сборка пишет в dist), и ключ, снятый после, был бы уже не про тот прогон.
    const prints = runnable.map((g) =>
      args.cache ? fingerprint(root, g.inputs, g.kind === 'command' ? g.command : `${g.path}:${g.max}:${g.gzip}`) : null,
    )

    const pending = runnable.map((g, i) => {
      const print = prints[i]
      if (print && cache[g.name] === print) return null
      return run(root, g)
    })

    for (let i = 0; i < runnable.length; i++) {
      const g = runnable[i] as Gate
      const print = prints[i]
      const task = pending[i]

      if (!task) {
        passed.add(g.name)
        if (print) fresh[g.name] = print
        report({ name: g.name, state: 'cached', optional: g.optional, ms: 0, note: 'без изменений', detail: '' })
        continue
      }

      const r = await task
      if (r.state === 'ok') {
        passed.add(r.name)
        // Запоминаем только успех: провал часто вызван причиной вне входов.
        if (print) fresh[g.name] = print
      }
      report(r)
    }

    for (const g of blocked) {
      const missing = g.needs.filter((n) => !passed.has(n))
      report({
        name: g.name,
        state: 'skip',
        optional: g.optional,
        ms: 0,
        note: `не прошли ${missing.join(', ')}`,
        detail: '',
      })
    }
  }

  if (args.cache) writeCache(root, fresh)

  const failed = results.filter((r) => r.state === 'fail' && !r.optional)
  const warned = results.filter((r) => r.state === 'fail' && r.optional)
  const skipped = results.filter((r) => r.state === 'skip')

  if (args.json) {
    process.stdout.write(JSON.stringify({ source: plan.source, results, failed: failed.length }, null, 2))
    return failed.length > 0 ? 1 : 0
  }

  for (const r of [...failed, ...warned]) {
    if (!r.detail) continue
    process.stdout.write(`\n  ${paint(r.optional ? '33' : '31', `── ${r.name}`)}\n`)
    process.stdout.write(
      r.detail
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n') + '\n',
    )
  }

  const total = `${((Date.now() - started) / 1000).toFixed(1)}с`
  const parts = [
    failed.length ? paint('31', `не прошли: ${failed.map((r) => r.name).join(', ')}`) : null,
    warned.length ? paint('33', `с оговорками: ${warned.map((r) => r.name).join(', ')}`) : null,
    skipped.length ? dim(`пропущено: ${skipped.map((r) => r.name).join(', ')}`) : null,
    dim(`${results.filter((r) => r.state === 'ok' || r.state === 'cached').length} из ${results.length} · ${total}`),
  ].filter(Boolean)

  process.stdout.write(`\n  ${parts.join(' · ')}\n\n`)
  return failed.length > 0 ? 1 : 0
}
