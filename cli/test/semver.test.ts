import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseVersion, satisfies } from '../src/util/semver.js'

test('точные версии и подстановки', () => {
  assert.equal(satisfies('1.2.3', '1.2.3'), true)
  assert.equal(satisfies('1.2.4', '1.2.3'), false)
  assert.equal(satisfies('5.0.0', '*'), true)
  assert.equal(satisfies('1.2.5', '1.2.x'), true)
  assert.equal(satisfies('1.3.0', '1.2.x'), false)
})

test('каретка и тильда', () => {
  assert.equal(satisfies('1.9.9', '^1.2.3'), true)
  assert.equal(satisfies('2.0.0', '^1.2.3'), false)
  assert.equal(satisfies('1.2.9', '~1.2.3'), true)
  assert.equal(satisfies('1.3.0', '~1.2.3'), false)
  // Ноль в старшем разряде: следующий значащий — минорный.
  assert.equal(satisfies('0.2.0', '^0.1.5'), false)
  assert.equal(satisfies('0.1.9', '^0.1.5'), true)
})

test('неполные версии в сравнениях — как в npm', () => {
  assert.equal(satisfies('24.19.0', '>=18'), true)
  assert.equal(satisfies('16.0.0', '>=18'), false)
  assert.equal(satisfies('18.0.0', '>=18'), true)
  // '>18' означает '>=19.0.0': оператор применяется к верхней границе.
  assert.equal(satisfies('24.0.0', '>18'), true)
  assert.equal(satisfies('18.5.0', '>18'), false)
  assert.equal(satisfies('17.9.9', '<18'), true)
  assert.equal(satisfies('18.9.0', '<=18'), true)
  assert.equal(satisfies('19.0.0', '<=18'), false)
})

test('объединения и пересечения', () => {
  assert.equal(satisfies('8.2.2', '^5.0.0 || ^6.0.0'), false)
  assert.equal(satisfies('8.2.2', '^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0'), true)
  assert.equal(satisfies('6.5.0', '>=5.0.0 <7.0.0'), true)
  assert.equal(satisfies('8.2.2', '>=5.0.0 <7.0.0'), false)
})

test('неразобранное даёт null, а не false', () => {
  // Молчать безопаснее, чем сообщать о несуществующем конфликте.
  assert.equal(satisfies('1.0.0', 'workspace:*'), null)
  assert.equal(satisfies('1.0.0', 'git+https://example.com/x.git'), null)
  assert.equal(satisfies('не-версия', '^1.0.0'), null)
  assert.equal(satisfies('1.0.0', ''), null)
})

test('пререлиз сравнивается по тройке чисел', () => {
  assert.deepEqual(parseVersion('1.0.0-beta.2'), [1, 0, 0])
  assert.equal(satisfies('1.0.0-beta.2', '^1.0.0'), true)
  assert.equal(parseVersion('v2.3.4')?.[0], 2)
  assert.equal(parseVersion('нет'), null)
})
