import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigError } from '../src/config.js'
import { loadConfig } from '../src/dev/config.js'
import { loadChecks } from '../src/check/config.js'

/** Кладём конфиг во временный каталог и возвращаем корень с путём к файлу. */
function fixture(config: unknown, pkg?: unknown): { root: string; file: string } {
  const root = mkdtempSync(join(tmpdir(), 'p3k-cfg-'))
  const file = join(root, 'p3k.json')
  writeFileSync(file, typeof config === 'string' ? config : JSON.stringify(config))
  if (pkg) writeFileSync(join(root, 'package.json'), JSON.stringify(pkg))
  return { root, file }
}

const throwsConfig = (fn: () => unknown, match: RegExp) =>
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof ConfigError, `ожидалась ConfigError, получено ${String(e)}`)
    assert.match((e as Error).message, match)
    return true
  })

// ── процессы ─────────────────────────────────────────────────────────────────

test('разбирает процессы со всеми полями', () => {
  const { root, file } = fixture({
    processes: {
      db: { command: 'docker run pg', ready: { port: 5432 }, stop: 'docker stop pg' },
      migrate: { command: 'npm run migrate', needs: ['db'], oneShot: true },
      api: { command: 'npm run dev', cwd: 'api', env: { PORT: 4000 }, needs: ['migrate'], ready: { log: 'ready' } },
    },
  })
  const cfg = loadConfig(root, file)
  assert.equal(cfg.processes.length, 3)

  const api = cfg.processes.find((p) => p.name === 'api')
  assert.equal(api?.cwd, 'api')
  // Числа в env приводятся к строкам: окружение процесса строковое.
  assert.equal(api?.env?.PORT, '4000')
  assert.deepEqual(api?.needs, ['migrate'])

  assert.equal(cfg.processes.find((p) => p.name === 'migrate')?.oneShot, true)
  assert.equal(cfg.processes.find((p) => p.name === 'db')?.oneShot, false)
})

test('процесс без command отвергается с указанием места', () => {
  const { root, file } = fixture({ processes: { a: { ready: { port: 1 } } } })
  throwsConfig(() => loadConfig(root, file), /processes\.a\.command/)
})

test('ссылка на несуществующий процесс отвергается', () => {
  const { root, file } = fixture({ processes: { a: { command: 'echo', needs: ['нет'] } } })
  throwsConfig(() => loadConfig(root, file), /нет процесса "нет"/)
})

test('зависимость от самого себя отвергается отдельным сообщением', () => {
  const { root, file } = fixture({ processes: { a: { command: 'echo', needs: ['a'] } } })
  throwsConfig(() => loadConfig(root, file), /зависит сам от себя/)
})

test('непонятное условие готовности отвергается', () => {
  const { root, file } = fixture({ processes: { a: { command: 'echo', ready: { когда: 'потом' } } } })
  throwsConfig(() => loadConfig(root, file), /ready/)
})

test('пустая секция процессов отвергается', () => {
  const { root, file } = fixture({ processes: {} })
  throwsConfig(() => loadConfig(root, file), /ни одного процесса/)
})

test('битый JSON и отсутствие файла — разные сообщения', () => {
  const { root, file } = fixture('{ "processes": ')
  throwsConfig(() => loadConfig(root, file), /не разобрали JSON/)
  throwsConfig(() => loadConfig(root, join(root, 'нет.json')), /не прочитали файл/)
})

// ── проверки ─────────────────────────────────────────────────────────────────

test('разбирает проверки обоих видов', () => {
  const { root, file } = fixture({
    processes: { a: { command: 'echo' } },
    checks: {
      types: { command: 'npm run typecheck' },
      lint: { command: 'npm run lint', optional: true },
      bundle: { size: { path: 'dist', max: '180kb', gzip: true }, needs: ['types'] },
    },
  })
  const plan = loadChecks(root, file)
  assert.equal(plan.source, file)
  assert.equal(plan.gates.length, 3)

  const bundle = plan.gates.find((g) => g.name === 'bundle')
  assert.equal(bundle?.kind, 'size')
  assert.equal(bundle?.kind === 'size' && bundle.max, 180 * 1024)
  assert.equal(bundle?.kind === 'size' && bundle.gzip, true)
  assert.deepEqual(bundle?.needs, ['types'])

  assert.equal(plan.gates.find((g) => g.name === 'lint')?.optional, true)
  assert.equal(plan.gates.find((g) => g.name === 'types')?.optional, false)
})

test('негодный бюджет отвергается с показом исходной записи', () => {
  const { root, file } = fixture({
    processes: { a: { command: 'echo' } },
    checks: { b: { size: { path: 'dist', max: 'сто килобайт' } } },
  })
  throwsConfig(() => loadChecks(root, file), /сто килобайт/)
})

test('проверка без command и без size отвергается', () => {
  const { root, file } = fixture({ processes: { a: { command: 'echo' } }, checks: { b: { optional: true } } })
  throwsConfig(() => loadChecks(root, file), /command.*size/)
})

test('ссылка на несуществующую проверку отвергается', () => {
  const { root, file } = fixture({
    processes: { a: { command: 'echo' } },
    checks: { b: { command: 'echo', needs: ['нет'] } },
  })
  throwsConfig(() => loadChecks(root, file), /нет проверки "нет"/)
})

test('без секции checks проверки выводятся из скриптов проекта', () => {
  const { root, file } = fixture(
    { processes: { a: { command: 'echo' } } },
    { name: 'x', scripts: { test: 'vitest', lint: 'eslint .', build: 'vite build', dev: 'vite' } },
  )
  const plan = loadChecks(root, file)
  // build и dev не берём: у первого побочные эффекты, второй не завершается.
  assert.deepEqual(plan.gates.map((g) => g.name), ['lint', 'test'])
  assert.equal(plan.gates[0]?.kind === 'command' && plan.gates[0].command, 'npm run lint')
  assert.match(plan.source, /package\.json/)
})

test('без конфига и без подходящих скриптов проверок нет', () => {
  const root = mkdtempSync(join(tmpdir(), 'p3k-empty-'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', scripts: { dev: 'vite' } }))
  assert.deepEqual(loadChecks(root, null).gates, [])
})
