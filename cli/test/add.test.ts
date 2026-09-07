import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AddError, mergeEnvExample, parsePortArg, planAdd, usedPorts } from '../src/add/plan.js'
import { RESOURCES, findResource } from '../src/add/resources.js'
import { loadConfig } from '../src/dev/config.js'

const app = () => ({
  processes: {
    build: { command: 'npm run build', oneShot: true },
    web: { command: 'npm run dev', ready: { port: 3000 } },
  },
})

test('ресурс попадает и в processes, и в реестр ресурсов', () => {
  const plan = planAdd({ config: null, resource: 'postgres', project: 'shop' })
  const config = plan.config as { processes: Record<string, any>; resources: Record<string, any> }

  assert.match(config.processes.postgres.command, /docker run .* --name shop-postgres/)
  assert.equal(config.processes.postgres.ready.exec, 'docker exec shop-postgres pg_isready -U postgres')
  assert.equal(config.processes.postgres.stop, 'docker stop shop-postgres')
  assert.deepEqual(config.resources.postgres, { type: 'postgres', ports: { port: 5432 } })
})

test('исходный конфиг не меняется', () => {
  const before = app()
  planAdd({ config: before, resource: 'redis', project: 'shop' })
  assert.deepEqual(before, app())
})

test('привязка выбирает единственный долгоживущий процесс, пропуская разовые шаги', () => {
  const plan = planAdd({ config: app(), resource: 'postgres', project: 'shop', link: 'auto' })
  const web = (plan.config as any).processes.web

  assert.equal(plan.linked, 'web')
  assert.deepEqual(web.needs, ['postgres'])
  assert.equal(web.env.DATABASE_URL, 'postgres://postgres:dev@localhost:5432/shop')
  assert.deepEqual(plan.applied.env, ['DATABASE_URL'])
  assert.equal(plan.applied.needs, true)
})

test('при двух долгоживущих процессах привязка не угадывается', () => {
  const config = app()
  ;(config.processes as Record<string, unknown>).api = { command: 'npm run api' }

  const plan = planAdd({ config, resource: 'redis', project: 'shop', link: 'auto' })
  assert.equal(plan.linked, null)
  assert.deepEqual(plan.candidates.sort(), ['api', 'build', 'web'])
})

test('--no-link оставляет процессы проекта нетронутыми', () => {
  const plan = planAdd({ config: app(), resource: 'redis', project: 'shop', link: null })
  assert.equal(plan.linked, null)
  assert.equal((plan.config as any).processes.web.env, undefined)
})

test('заданные вручную переменные сохраняются и попадают в отчёт', () => {
  const config = app() as any
  config.processes.web.env = { DATABASE_URL: 'postgres://свой-адрес/db' }

  const plan = planAdd({ config, resource: 'postgres', project: 'shop', link: 'auto' })
  assert.equal((plan.config as any).processes.web.env.DATABASE_URL, 'postgres://свой-адрес/db')
  assert.deepEqual(plan.applied.kept, ['DATABASE_URL'])
  assert.deepEqual(plan.applied.env, [])
})

test('повторное имя — отказ с подсказкой', () => {
  const first = planAdd({ config: app(), resource: 'redis', project: 'shop' })
  assert.throws(
    () => planAdd({ config: first.config, resource: 'redis', project: 'shop' }),
    (e: unknown) => e instanceof AddError && /--name/.test(e.message),
  )
})

test('второй такой же ресурс под своим именем и портом добавляется', () => {
  const first = planAdd({ config: app(), resource: 'redis', project: 'shop' })
  const second = planAdd({
    config: first.config,
    resource: 'redis',
    project: 'shop',
    name: 'queue',
    ports: { port: 6380 },
  })
  assert.match((second.config as any).processes.queue.command, /-p 6380:6379/)
})

test('занятый в этом же конфиге порт — отказ', () => {
  const first = planAdd({ config: app(), resource: 'postgres', project: 'shop' })
  assert.throws(
    () => planAdd({ config: first.config, resource: 'postgres', project: 'shop', name: 'db2' }),
    (e: unknown) => e instanceof AddError && /порт 5432/.test(e.message),
  )
})

test('порт, по которому ресурс только ходит, конфликтом не считается', () => {
  // Апстрим прокси — это порт самого приложения, и он занят по определению.
  const plan = planAdd({ config: app(), resource: 'nginx', project: 'shop', ports: { web: 3000 } })
  assert.match((plan.config as any).processes.nginx.command, /-p 8080:80/)
  assert.match(plan.files['nginx.dev.conf'] ?? '', /host\.docker\.internal:3000/)
})

test('разбор --port: голое число и id=номер', () => {
  const mailpit = findResource('mailpit')
  assert.ok(mailpit)
  assert.deepEqual(parsePortArg('1030', mailpit), ['smtp', 1030])
  assert.deepEqual(parsePortArg('web=8030', mailpit), ['web', 8030])
  assert.throws(() => parsePortArg('нет=1', mailpit), AddError)
  assert.throws(() => parsePortArg('0', mailpit), AddError)
})

test('занятые порты вычитываются из проброса docker и из ready', () => {
  const used = usedPorts({
    processes: {
      db: { command: 'docker run --rm -p 127.0.0.1:5432:5432 postgres:16' },
      web: { command: 'npm run dev', ready: { port: 3000 } },
    },
  })
  assert.equal(used.get(5432), 'db')
  assert.equal(used.get(3000), 'web')
  assert.equal(used.get(80), undefined)
})

test('.env.example дописывается, а не переписывается', () => {
  const next = mergeEnvExample('PORT=4000\n', 'Redis 7 — redis', { REDIS_URL: 'redis://localhost:6379' })
  assert.equal(next, 'PORT=4000\n\n# Redis 7 — redis\nREDIS_URL=redis://localhost:6379\n')
})

test('.env.example не трогается, если ключи уже есть', () => {
  assert.equal(mergeEnvExample('REDIS_URL=redis://свой\n', 'Redis 7', { REDIS_URL: 'x' }), null)
  assert.equal(mergeEnvExample('export REDIS_URL=x\n', 'Redis 7', { REDIS_URL: 'x' }), null)
})

test('пустой .env.example получает блок без ведущих пустых строк', () => {
  assert.equal(mergeEnvExample('', 'MinIO', { S3_BUCKET: 'shop' }), '# MinIO\nS3_BUCKET=shop\n')
})

/**
 * Каталог ресурсов — данные, и ошибка в нём проявилась бы только у человека,
 * который эту команду запустил. Поэтому каждый ресурс проверяется тем же
 * разбором конфига, что и настоящий проект.
 */
test('каждый ресурс из каталога даёт конфиг, который читает dev', () => {
  for (const resource of RESOURCES) {
    const plan = planAdd({ config: app(), resource: resource.id, project: 'shop', link: 'auto' })

    const root = mkdtempSync(join(tmpdir(), 'p3k-add-'))
    const file = join(root, 'p3k.json')
    writeFileSync(file, JSON.stringify(plan.config, null, 2))

    const loaded = loadConfig(root, file)
    const spec = loaded.processes.find((p) => p.name === plan.name)
    assert.ok(spec, `${resource.id}: процесс не разобрался`)
    assert.ok(spec.command.length > 0, `${resource.id}: пустая команда`)
    assert.ok(spec.ready, `${resource.id}: нет условия готовности`)
    assert.ok(spec.stop, `${resource.id}: нет команды остановки — контейнер переживёт Ctrl+C`)
    assert.ok(Object.keys(plan.env).length > 0, `${resource.id}: ресурс ничего не даёт приложению`)
  }
})

test('порты ресурсов внутри каталога не пересекаются по умолчанию', () => {
  const seen = new Map<number, string>()
  for (const resource of RESOURCES) {
    for (const spec of resource.ports) {
      if (!spec.bind) continue
      const owner = seen.get(spec.port)
      assert.equal(owner, undefined, `порт ${spec.port} по умолчанию и у "${owner}", и у "${resource.id}"`)
      seen.set(spec.port, resource.id)
    }
  }
})
