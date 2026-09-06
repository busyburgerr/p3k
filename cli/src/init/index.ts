import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { exec } from '../util/exec.js'
import { TEMPLATES, findTemplate, slugify, type Template } from './templates.js'

export const INIT_HELP = `
  p3k init — каркас проекта и конфиг, с которого начинается всё остальное

  Использование:
    p3k init [каталог] [опции]

  Опции:
    --template <id>  шаблон; без него спросим, если терминал интерактивный
    --name <имя>     имя проекта (по умолчанию — имя каталога)
    --list           показать доступные шаблоны
    --force          писать в непустой каталог (существующие файлы не трогаем)
    --no-git         не создавать git-репозиторий
    --help           эта справка

  Создаёт p3k.json — его читают dev, check и ship.
`

interface Args {
  dir: string
  template: string | null
  name: string | null
  list: boolean
  force: boolean
  git: boolean
  help: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dir: '.', template: null, name: null, list: false, force: false, git: true, help: false }
  let dirSeen = false

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') args.help = true
    else if (a === '--list') args.list = true
    else if (a === '--force') args.force = true
    else if (a === '--no-git') args.git = false
    else if (a === '--template') args.template = argv[++i] ?? null
    else if (a === '--name') args.name = argv[++i] ?? null
    else if (a && !a.startsWith('-') && !dirSeen) {
      args.dir = a
      dirSeen = true
    }
  }
  return args
}

function listTemplates(): string {
  const width = TEMPLATES.reduce((m, t) => Math.max(m, t.id.length), 0)
  const lines = TEMPLATES.map((t) => {
    const need = t.requires ? ` (нужен ${t.requires})` : ''
    return `    ${t.id.padEnd(width)}  ${t.title} — ${t.summary}${need}`
  })
  return `\n  Шаблоны:\n${lines.join('\n')}\n`
}

async function askTemplate(): Promise<Template | null> {
  process.stdout.write(listTemplates())
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question(`\n  Шаблон [${TEMPLATES[0]?.id}]: `)).trim()
    return findTemplate(answer === '' ? (TEMPLATES[0]?.id ?? '') : answer)
  } finally {
    rl.close()
  }
}

const fill = (text: string, name: string) => text.split('{{name}}').join(name)

export async function runInit(argv: string[]): Promise<number> {
  const args = parseArgs(argv)

  if (args.help) {
    process.stdout.write(INIT_HELP)
    return 0
  }
  if (args.list) {
    process.stdout.write(listTemplates())
    return 0
  }

  const dir = resolve(args.dir)
  const name = slugify(args.name ?? basename(dir))

  let template: Template | null = args.template ? findTemplate(args.template) : null
  if (args.template && !template) {
    process.stderr.write(`init: нет шаблона "${args.template}"\n${listTemplates()}`)
    return 2
  }
  if (!template) {
    if (!process.stdin.isTTY) {
      process.stderr.write(`init: укажите --template — спросить некого, терминал не интерактивный\n${listTemplates()}`)
      return 2
    }
    template = await askTemplate()
    if (!template) {
      process.stderr.write('init: такого шаблона нет\n')
      return 2
    }
  }

  // Каталог с чужими файлами — повод остановиться, а не «аккуратно дополнить».
  if (existsSync(dir)) {
    const entries = readdirSync(dir).filter((e) => e !== '.git')
    if (entries.length > 0 && !args.force) {
      process.stderr.write(
        `init: каталог не пуст (${entries.length} записей): ${dir}\n` +
          `     повторите с --force, если всё равно хотите добавить туда файлы\n`,
      )
      return 2
    }
  } else {
    mkdirSync(dir, { recursive: true })
  }

  const written: string[] = []
  const skipped: string[] = []

  for (const [path, content] of Object.entries(template.files)) {
    const target = join(dir, fill(path, name))
    // Даже с --force существующий файл не трогаем: перезапись чужой работы
    // необратима, а пропуск виден в отчёте и легко исправляется руками.
    if (existsSync(target)) {
      skipped.push(fill(path, name))
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, fill(content, name), 'utf8')
    written.push(fill(path, name))
  }

  let git = ''
  if (args.git && !existsSync(join(dir, '.git'))) {
    // cwd обязателен: без него репозиторий создастся там, откуда запущена
    // команда, а не в каталоге проекта.
    const res = await exec('git', ['init', '-q'], 10_000, dir)
    if (res.missing) git = 'git не найден — репозиторий не создан'
    else if (!res.ok) git = 'git init не отработал — репозиторий не создан'
    else git = 'создан git-репозиторий'
  }

  const out: string[] = ['', `  ${template.title} → ${dir}`, '']
  const requested = args.name ?? basename(dir)
  if (name !== requested) {
    out.push(`  имя проекта: "${name}" — в "${requested}" есть символы, недопустимые в имени пакета`, '')
  }
  for (const f of written) out.push(`  + ${f}`)
  for (const f of skipped) out.push(`  · ${f} — уже существует, оставлен как был`)
  if (git) out.push('', `  ${git}`)

  out.push('', '  Дальше:')
  if (dir !== process.cwd()) out.push(`    cd ${args.dir}`)
  for (const step of template.next) out.push(`    ${step}`)
  if (template.requires) out.push('', `  Нужен ${template.requires}. Проверить окружение: p3k doctor`)
  out.push('')

  process.stdout.write(out.join('\n'))
  return 0
}
