import { test } from 'node:test'
import assert from 'node:assert/strict'
import { envExample, planCompose, toYaml, unfilled } from '../src/ship/compose.js'
import { RESOURCES } from '../src/add/resources.js'
import type { ResourceRecord } from '../src/add/plan.js'

const registry = (entries: Record<string, ResourceRecord>) => entries

test('строки выводятся в кавычках — иначе YAML сам решит, что это число или дата', () => {
  assert.equal(toYaml({ image: 'postgres:16' }), '\nimage: "postgres:16"\n')
  assert.equal(toYaml({ retries: 20 }), '\nretries: 20\n')
  assert.equal(toYaml({ ports: ['127.0.0.1:5432:5432'] }), '\nports:\n  - "127.0.0.1:5432:5432"\n')
})

test('вложенность и пустые значения', () => {
  const yaml = toYaml({ services: { db: { environment: { A: 'b' } } }, volumes: { 'db-data': null } })
  assert.match(yaml, /services:\n {2}db:\n {4}environment:\n {6}A: "b"/)
  assert.match(yaml, /volumes:\n {2}db-data: null/)
})

test('compose собирается из реестра ресурсов', () => {
  const plan = planCompose(registry({ db: { type: 'postgres', ports: { port: 5432 } } }), 'магазин')
  assert.ok(plan)
  assert.deepEqual(plan.services, ['db'])
  assert.match(plan.yaml, /image: "postgres:16"/)
  assert.match(plan.yaml, /db-data:\/var\/lib\/postgresql\/data/)
  assert.match(plan.yaml, /volumes:\n {2}db-data: null/, 'том должен быть объявлен на верхнем уровне')
})

/**
 * Открытый наружу порт базы — самая дорогая из опечаток в этом файле,
 * поэтому она проверяется отдельно и для всех ресурсов сразу.
 */
test('в проде порты служб выставлены только на петлю', () => {
  for (const resource of RESOURCES) {
    if (!resource.prod) continue
    const ports: Record<string, number> = {}
    for (const spec of resource.ports) ports[spec.id] = spec.port

    const form = resource.prod({ name: resource.id, container: `x-${resource.id}`, project: 'x', ports })
    for (const mapping of (form.service.ports as string[]) ?? []) {
      // Край — единственное исключение: он и должен смотреть в интернет.
      const expected = resource.id === 'nginx' ? /^80:80$/ : /^127\.0\.0\.1:/
      assert.match(mapping, expected, `${resource.id}: проброс "${mapping}"`)
    }
  }
})

test('в проде каждая служба перезапускается сама', () => {
  for (const resource of RESOURCES) {
    if (!resource.prod) continue
    const ports: Record<string, number> = {}
    for (const spec of resource.ports) ports[spec.id] = spec.port
    const form = resource.prod({ name: resource.id, container: `x-${resource.id}`, project: 'x', ports })

    assert.equal(form.service.restart, 'unless-stopped', `${resource.id}: нет перезапуска`)
    assert.ok(form.service.healthcheck, `${resource.id}: нет проверки здоровья — --wait ждать нечего`)
  }
})

test('пароли в compose не попадают — только ссылки на shared/.env', () => {
  const plan = planCompose(
    registry({ db: { type: 'postgres', ports: { port: 5432 } }, s3: { type: 'minio', ports: { api: 9000, console: 9001 } } }),
    'магазин',
  )
  assert.ok(plan)
  assert.match(plan.yaml, /\$\{POSTGRES_PASSWORD:\?/)
  assert.doesNotMatch(plan.yaml, /minioadmin/, 'локальные ключи не должны утечь в прод')
})

test('ресурсу для разработки в проде места нет', () => {
  const plan = planCompose(
    registry({ mail: { type: 'mailpit', ports: { smtp: 1025, web: 8025 } }, db: { type: 'postgres', ports: { port: 5432 } } }),
    'магазин',
  )
  assert.ok(plan)
  assert.deepEqual(plan.services, ['db'])
  assert.deepEqual(plan.skipped, ['mail (Mailpit)'])
})

test('только неизвестные и только dev-ресурсы дают пустой план, а не поломку', () => {
  assert.equal(planCompose(registry({ x: { type: 'чего-то-нет', ports: {} } }), 'магазин'), null)
  assert.equal(planCompose(registry({ mail: { type: 'mailpit', ports: {} } }), 'магазин'), null)
  assert.equal(planCompose(registry({}), 'магазин'), null)
})

test('заготовка секретов перечисляет незаполненное', () => {
  const plan = planCompose(registry({ db: { type: 'postgres', ports: { port: 5432 } } }), 'магазин')
  assert.ok(plan)
  assert.deepEqual(unfilled(plan.env), ['POSTGRES_PASSWORD', 'DATABASE_URL'])
  assert.match(envExample(plan.env), /^POSTGRES_PASSWORD=<.+>$/m)
})

test('у кэша заполнять нечего — адрес известен заранее', () => {
  const plan = planCompose(registry({ cache: { type: 'redis', ports: { port: 6379 } } }), 'магазин')
  assert.ok(plan)
  assert.deepEqual(unfilled(plan.env), [])
  assert.equal(plan.env.REDIS_URL, 'redis://localhost:6379')
})
