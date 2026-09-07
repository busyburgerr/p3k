import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, resolve, basename } from 'node:path'
import type { ProjectPort } from '../types.js'
import { slugify } from '../init/templates.js'

export function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Корень проекта — ближайший вверх каталог с package.json. */
export function findRoot(start: string): string {
  let dir = resolve(start)
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const up = dirname(dir)
    if (up === dir) return resolve(start)
    dir = up
  }
}

/**
 * Имя проекта: из package.json, иначе из имени каталога.
 *
 * Идёт в имена контейнеров, базы и compose-проекта, поэтому приводится к тому
 * же виду, что и при init: иначе локальное и продакшен-окружения назвали бы
 * одно и то же по-разному.
 */
export function projectName(root: string): string {
  const pkg = readJson(join(root, 'package.json'))
  return slugify(typeof pkg?.name === 'string' ? pkg.name : basename(root))
}

const CONFIG_NAMES = /^(vite|next|nuxt|astro|svelte|webpack|vue)\.config\.[cm]?[jt]s$/

/**
 * Порты, которые проект собирается занять.
 *
 * Источники читаются текстом, а не исполняются: конфиг может импортировать
 * что угодно, а запускать чужой код ради номера порта — плохой размен.
 * Поэтому каждый найденный порт помечается источником, чтобы вывод можно было
 * перепроверить глазами.
 */
export function discoverPorts(root: string, explicit: number[]): ProjectPort[] {
  const found = new Map<number, string>()
  const add = (port: number, source: string) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) return
    if (!found.has(port)) found.set(port, source)
  }

  for (const p of explicit) add(p, 'аргумент --port')

  const pkg = readJson(join(root, 'package.json'))
  const scripts = (pkg?.scripts ?? {}) as Record<string, string>
  for (const [name, cmd] of Object.entries(scripts)) {
    if (typeof cmd !== 'string') continue
    for (const m of cmd.matchAll(/--port[= ](\d{2,5})/g)) add(Number(m[1]), `package.json → scripts.${name}`)
  }

  let entries: string[] = []
  try {
    entries = readdirSync(root)
  } catch {
    entries = []
  }
  for (const name of entries) {
    if (!CONFIG_NAMES.test(name)) continue
    let text = ''
    try {
      text = readFileSync(join(root, name), 'utf8')
    } catch {
      continue
    }
    for (const m of text.matchAll(/\bport\s*:\s*(\d{2,5})\b/g)) add(Number(m[1]), name)
  }

  if (found.size === 0) add(3000, 'значение по умолчанию')

  return [...found.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([port, source]) => ({ port, source }))
}

/** Ключи из .env-подобного файла. Значения нам не нужны и мы их не читаем. */
export function envKeys(file: string): string[] {
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const keys: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)
    if (m?.[1]) keys.push(m[1])
  }
  return keys
}
