/**
 * Рецепты на сайте — это то, что люди копируют себе. Проверяем их настоящим
 * разбором из CLI, а не глазами: JSON валиден, needs сходятся в граф, условия
 * готовности допустимы.
 *
 * Исходник читаем текстом и достаём массивы config: транспиляция TS ради этого
 * не нужна, а лишняя зависимость в проверке — тем более. Чего проверка не
 * покажет: что образ действительно поднимется. Это отмечено в тексте рецептов.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const load = (rel) => import(pathToFileURL(resolve(rel)).href)

let loadConfig, loadChecks, startupWaves
try {
  ;({ loadConfig } = await load('cli/dist/dev/config.js'))
  ;({ loadChecks } = await load('cli/dist/check/config.js'))
  ;({ startupWaves } = await load('cli/dist/dev/graph.js'))
} catch {
  console.error('нужна сборка CLI: cd cli && npm run build')
  process.exit(1)
}

const src = readFileSync('src/data.recipes.ts', 'utf8')
const recipes = [...src.matchAll(/id: '([^']+)',[\s\S]*?config: \[([\s\S]*?)\n {4}\],/g)].map(([, id, body]) => ({
  id,
  json: [...body.matchAll(/^\s*'(.*)',?$/gm)].map((m) => m[1].replace(/\\'/g, "'")).join('\n'),
}))

if (recipes.length === 0) {
  console.error('рецептов не найдено — сломался разбор data.recipes.ts')
  process.exit(1)
}

let bad = 0
for (const recipe of recipes) {
  let parsed
  try {
    parsed = JSON.parse(recipe.json)
  } catch (e) {
    console.error(`✗ ${recipe.id}: невалидный JSON — ${e.message}`)
    bad++
    continue
  }

  const root = mkdtempSync(join(tmpdir(), 'p3k-recipe-'))
  const file = join(root, 'p3k.json')
  writeFileSync(file, recipe.json)
  writeFileSync(join(root, 'package.json'), '{"name":"recipe","private":true}')

  try {
    const parts = []
    if (parsed.processes) {
      const cfg = loadConfig(root, file)
      parts.push(`${cfg.processes.length} процессов, ${startupWaves(cfg.processes).length} волн`)
    }
    if (parsed.checks) {
      parts.push(`${loadChecks(root, file).gates.length} проверок`)
    }
    console.log(`  ✓ ${recipe.id.padEnd(12)} ${parts.join(' · ')}`)
  } catch (e) {
    console.error(`  ✗ ${recipe.id}: ${e.message}`)
    bad++
  }
}

console.log(bad === 0 ? `  все ${recipes.length} рецептов разбираются` : `  сломанных: ${bad}`)
process.exit(bad === 0 ? 0 : 1)
