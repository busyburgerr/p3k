import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSize, formatSize, measure } from '../src/check/size.js'

test('разбор записи бюджета', () => {
  assert.equal(parseSize('900'), 900)
  assert.equal(parseSize('180kb'), 180 * 1024)
  assert.equal(parseSize('1.5mb'), Math.round(1.5 * 1024 * 1024))
  assert.equal(parseSize(' 2 KB '), 2048)
  assert.equal(parseSize(4096), 4096)
})

test('негодная запись даёт null, а не молчаливый ноль', () => {
  assert.equal(parseSize('сто килобайт'), null)
  assert.equal(parseSize('12tb'), null)
  assert.equal(parseSize(''), null)
  assert.equal(parseSize(-5), null)
})

test('вывод размера человеку', () => {
  assert.equal(formatSize(512), '512b')
  assert.equal(formatSize(2048), '2.0kb')
  assert.equal(formatSize(3 * 1024 * 1024), '3.00mb')
})

test('измерение каталога складывает все файлы и сортирует по убыванию', () => {
  const root = mkdtempSync(join(tmpdir(), 'p3k-size-'))
  mkdirSync(join(root, 'dist', 'nested'), { recursive: true })
  writeFileSync(join(root, 'dist', 'big.js'), 'x'.repeat(3000))
  writeFileSync(join(root, 'dist', 'nested', 'small.css'), 'y'.repeat(500))

  const raw = measure(root, 'dist', false)
  assert.ok(raw)
  assert.equal(raw.total, 3500)
  assert.equal(raw.files.length, 2)
  assert.equal(raw.files[0]?.path, 'dist/big.js')
  // Путь всегда через прямой слэш, независимо от системы.
  assert.equal(raw.files[1]?.path, 'dist/nested/small.css')
})

test('gzip сжимает каждый файл отдельно, как их отдаст сервер', () => {
  const root = mkdtempSync(join(tmpdir(), 'p3k-gzip-'))
  mkdirSync(join(root, 'dist'), { recursive: true })
  writeFileSync(join(root, 'dist', 'a.js'), 'x'.repeat(10000))

  const raw = measure(root, 'dist', false)
  const gz = measure(root, 'dist', true)
  assert.ok(raw && gz)
  assert.equal(raw.total, 10000)
  assert.ok(gz.total < raw.total, 'сжатое должно быть меньше исходного')
})

test('одиночный файл измеряется как файл', () => {
  const root = mkdtempSync(join(tmpdir(), 'p3k-one-'))
  writeFileSync(join(root, 'app.js'), 'z'.repeat(77))
  const m = measure(root, 'app.js', false)
  assert.equal(m?.total, 77)
  assert.equal(m?.files.length, 1)
})

test('отсутствующий путь даёт null — это не ноль байт', () => {
  const root = mkdtempSync(join(tmpdir(), 'p3k-none-'))
  assert.equal(measure(root, 'dist', false), null)
})
