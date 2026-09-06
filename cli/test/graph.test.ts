import { test } from 'node:test'
import assert from 'node:assert/strict'
import { waves, unknownNeeds, CycleError } from '../src/util/graph.js'

const n = (name: string, ...needs: string[]) => ({ name, needs })

test('независимые узлы идут одной волной', () => {
  const result = waves([n('a'), n('b'), n('c')])
  assert.equal(result.length, 1)
  assert.deepEqual(result[0]?.map((x) => x.name).sort(), ['a', 'b', 'c'])
})

test('цепочка разворачивается в отдельные волны', () => {
  const result = waves([n('c', 'b'), n('b', 'a'), n('a')])
  assert.deepEqual(result.map((w) => w.map((x) => x.name)), [['a'], ['b'], ['c']])
})

test('ромб: середина параллельна, схождение — отдельной волной', () => {
  const result = waves([n('d', 'b', 'c'), n('b', 'a'), n('c', 'a'), n('a')])
  assert.equal(result.length, 3)
  assert.deepEqual(result[1]?.map((x) => x.name).sort(), ['b', 'c'])
  assert.deepEqual(result[2]?.map((x) => x.name), ['d'])
})

test('цикл распознаётся и называет участников', () => {
  assert.throws(() => waves([n('a', 'b'), n('b', 'a')]), (e: unknown) => {
    assert.ok(e instanceof CycleError)
    assert.match((e as Error).message, /a, b/)
    return true
  })
})

test('узел, зависящий сам от себя, — тоже цикл', () => {
  assert.throws(() => waves([n('a', 'a')]), CycleError)
})

test('ссылки на несуществующие узлы находятся отдельно', () => {
  assert.deepEqual(unknownNeeds([n('a', 'нет'), n('b')]), [{ name: 'a', missing: 'нет' }])
  assert.deepEqual(unknownNeeds([n('a'), n('b', 'a')]), [])
})

test('пустой список даёт пустой план', () => {
  assert.deepEqual(waves([]), [])
})
