import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fingerprint, readCache, writeCache } from '../src/check/cache.js'

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'p3k-cache-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'a.ts'), 'const a = 1')
  writeFileSync(join(root, 'src', 'b.ts'), 'const b = 2')
  writeFileSync(join(root, 'package.json'), '{"name":"x"}')
  return root
}

test('одинаковые входы дают одинаковый отпечаток', () => {
  const root = project()
  assert.equal(fingerprint(root, ['src'], 'cmd'), fingerprint(root, ['src'], 'cmd'))
})

test('порядок перечисления входов не влияет', () => {
  const root = project()
  assert.equal(
    fingerprint(root, ['src', 'package.json'], 'cmd'),
    fingerprint(root, ['package.json', 'src'], 'cmd'),
  )
})

test('изменение содержимого меняет отпечаток', () => {
  const root = project()
  const before = fingerprint(root, ['src'], 'cmd')
  writeFileSync(join(root, 'src', 'a.ts'), 'const a = 2')
  assert.notEqual(fingerprint(root, ['src'], 'cmd'), before)
})

test('время изменения без правки содержимого отпечаток не трогает', () => {
  // После git checkout mtime меняется, а содержимое нет — кэш сбрасываться не должен.
  const root = project()
  const before = fingerprint(root, ['src'], 'cmd')
  const later = new Date(Date.now() + 60_000)
  utimesSync(join(root, 'src', 'a.ts'), later, later)
  assert.equal(fingerprint(root, ['src'], 'cmd'), before)
})

test('добавление и удаление файла меняют отпечаток', () => {
  const root = project()
  const before = fingerprint(root, ['src'], 'cmd')
  writeFileSync(join(root, 'src', 'c.ts'), 'const c = 3')
  const added = fingerprint(root, ['src'], 'cmd')
  assert.notEqual(added, before)
  rmSync(join(root, 'src', 'c.ts'))
  assert.equal(fingerprint(root, ['src'], 'cmd'), before)
})

test('смена команды обесценивает прошлый результат', () => {
  const root = project()
  assert.notEqual(fingerprint(root, ['src'], 'npm test'), fingerprint(root, ['src'], 'npm run lint'))
})

test('отсутствующий вход учитывается, а не игнорируется', () => {
  const root = project()
  const missing = fingerprint(root, ['нет-такого'], 'cmd')
  assert.ok(missing)
  // Появление файла по этому пути должно менять ключ.
  writeFileSync(join(root, 'нет-такого'), 'теперь есть')
  assert.notEqual(fingerprint(root, ['нет-такого'], 'cmd'), missing)
})

test('без объявленных входов кэшировать нельзя', () => {
  assert.equal(fingerprint(project(), [], 'cmd'), null)
})

test('хранилище переживает запись и чтение', () => {
  const root = project()
  assert.deepEqual(readCache(root), {})
  writeCache(root, { types: 'abc', build: 'def' })
  assert.deepEqual(readCache(root), { types: 'abc', build: 'def' })
})

test('битый файл кэша не роняет прогон', () => {
  const root = project()
  mkdirSync(join(root, '.p3k'), { recursive: true })
  writeFileSync(join(root, '.p3k', 'check.json'), '{ это не json')
  assert.deepEqual(readCache(root), {})
})
