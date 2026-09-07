import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { findConfig, readConfigJson, ConfigError } from '../config.js'
import { findRoot, projectName } from '../util/project.js'
import { listeners } from '../util/net.js'
import { exec } from '../util/exec.js'
import { RESOURCES, findResource } from './resources.js'
import { AddError, mergeEnvExample, parsePortArg, planAdd, type AddPlan } from './plan.js'

export const ADD_HELP = `
  p3k add — добавить проекту ресурс: базу, кэш, хранилище, прокси

  Использование:
    p3k add <ресурс> [опции]

  Опции:
    --name <имя>       имя процесса в конфиге (по умолчанию — имя ресурса)
    --port <n|id=n>    занять другой порт; можно повторять
    --link <процесс>   к какому процессу привязать переменные и порядок запуска
    --no-link          не привязывать ни к чему
    --dry-run          показать, что изменится, и ничего не записать
    --force            добавить, даже если порт уже кем-то занят на этой машине
    --list             список ресурсов
    --help             эта справка

  Правит p3k.json и .env.example. Существующие значения не перезаписываются.
`

interface Args {
  resource: string | null
  name: string | null
  ports: string[]
  link: string | 'auto' | null
  dryRun: boolean
  force: boolean
  list: boolean
  help: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    resource: null,
    name: null,
    ports: [],
    link: 'auto',
    dryRun: false,
    force: false,
    list: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') args.help = true
    else if (a === '--list') args.list = true
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--force') args.force = true
    else if (a === '--no-link') args.link = null
    else if (a === '--name') args.name = argv[++i] ?? null
    else if (a === '--link') args.link = argv[++i] ?? 'auto'
    else if (a === '--port') {
      const v = argv[++i]
      if (v !== undefined) args.ports.push(v)
    } else if (a && !a.startsWith('-') && args.resource === null) args.resource = a
  }
  return args
}

function listResources(): string {
  const width = RESOURCES.reduce((m, r) => Math.max(m, r.id.length), 0)
  const lines = RESOURCES.map((r) => {
    const ports = r.ports
      .filter((p) => p.bind)
      .map((p) => p.port)
      .join(', ')
    return `    ${r.id.padEnd(width)}  ${r.title} — ${r.summary}  [порт ${ports}]`
  })
  return `\n  Ресурсы:\n${lines.join('\n')}\n\n  Нужен Docker. Проверить окружение: p3k doctor\n`
}

/**
 * Кто уже слушает порт прямо сейчас.
 *
 * Конфиг мы проверили раньше, но занять порт может что угодно другое —
 * системный Postgres, забытый контейнер, соседний проект. Дешевле сказать об
 * этом сейчас, чем разбирать потом, почему контейнер молча умер на старте.
 */
async function occupied(plan: AddPlan): Promise<string[]> {
  const problems: string[] = []
  for (const spec of plan.resource.ports) {
    if (!spec.bind) continue
    const chosen = plan.ports[spec.id] as number
    const found = await listeners(chosen)
    if (found.length === 0) continue
    const who = found
      .map((l) => [l.process, l.pid === undefined ? null : `PID ${l.pid}`].filter(Boolean).join(' '))
      .filter((v, i, a) => v !== '' && a.indexOf(v) === i)
      .join(', ')
    problems.push(`порт ${chosen} (${spec.what}) уже слушает ${who || 'неизвестный процесс'}`)
  }
  return problems
}

export async function runAdd(argv: string[]): Promise<number> {
  const args = parseArgs(argv)

  if (args.help) {
    process.stdout.write(ADD_HELP + listResources())
    return 0
  }
  if (args.list) {
    process.stdout.write(listResources())
    return 0
  }
  if (!args.resource) {
    process.stderr.write(`add: не указан ресурс\n${listResources()}`)
    return 2
  }

  const resource = findResource(args.resource)
  if (!resource) {
    process.stderr.write(`add: нет ресурса "${args.resource}"\n${listResources()}`)
    return 2
  }

  const root = findRoot(process.cwd())
  const file = findConfig(root) ?? join(root, 'p3k.json')
  const fresh = !existsSync(file)

  let config: Record<string, unknown> | null = null
  if (!fresh) {
    try {
      config = readConfigJson(file)
    } catch (e) {
      process.stderr.write(`add: ${e instanceof ConfigError ? e.message : String(e)}\n`)
      return 2
    }
  }

  let plan: AddPlan
  try {
    const ports: Record<string, number> = {}
    for (const raw of args.ports) {
      const [id, value] = parsePortArg(raw, resource)
      ports[id] = value
    }
    plan = planAdd({
      config,
      resource: resource.id,
      project: projectName(root),
      name: args.name ?? undefined,
      ports,
      link: args.link,
    })
  } catch (e) {
    process.stderr.write(`add: ${e instanceof AddError ? e.message : String(e)}\n`)
    return 2
  }

  const busy = await occupied(plan)
  if (busy.length > 0 && !args.force) {
    const first = plan.resource.ports.find((p) => p.bind)
    process.stderr.write(
      `add: ${busy.join('\n     ')}\n` +
        `     возьмите другой порт (--port ${first?.id}=${(plan.ports[first?.id ?? ''] ?? 0) + 1}), ` +
        `освободите этот или добавьте всё равно с --force\n`,
    )
    return 2
  }

  // Отчёт собираем до записи: при --dry-run он и есть весь результат.
  const rel = basename(file)
  const changes: string[] = []
  changes.push(`  + ${rel} → processes.${plan.name}`)
  changes.push(`  + ${rel} → resources.${plan.name}`)
  if (plan.linked) {
    const what = [plan.applied.needs ? 'needs' : null, plan.applied.env.length > 0 ? 'env' : null].filter(Boolean)
    if (what.length > 0) changes.push(`  ~ ${rel} → processes.${plan.linked}: ${what.join(', ')}`)
  }

  const envFile = join(root, '.env.example')
  const envText = existsSync(envFile) ? readFileSync(envFile, 'utf8') : ''
  const envNext = mergeEnvExample(envText, `${plan.resource.title} — ${plan.name}`, plan.env)
  const envKeys = Object.keys(plan.env)
  if (envNext) changes.push(`  ${existsSync(envFile) ? '~' : '+'} .env.example: ${envKeys.join(', ')}`)

  const files: [string, string][] = []
  for (const [name, content] of Object.entries(plan.files)) {
    const target = join(root, name)
    // Существующий файл не перезаписываем: правки в nginx.dev.conf — работа
    // человека, а вернуть её после перезаписи неоткуда.
    if (existsSync(target)) changes.push(`  · ${name} — уже есть, оставлен как был`)
    else {
      files.push([target, content])
      changes.push(`  + ${name}`)
    }
  }

  if (!args.dryRun) {
    if (fresh) mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(plan.config, null, 2) + '\n', 'utf8')
    if (envNext) writeFileSync(envFile, envNext, 'utf8')
    for (const [target, content] of files) {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, content, 'utf8')
    }
  }

  const out: string[] = ['', `  ${plan.resource.title} → ${plan.name}${args.dryRun ? '   (ничего не записано)' : ''}`, '']
  if (fresh && !args.dryRun) out.push(`  создан ${rel} — раньше конфига в проекте не было`, '')
  out.push(...changes, '')

  const bound = plan.resource.ports.filter((p) => p.bind)
  out.push(`  Контейнер: ${plan.container}`)
  for (const p of bound) out.push(`  Порт ${plan.ports[p.id]} — ${p.what}`)

  if (plan.linked && plan.applied.env.length > 0) {
    out.push('', `  Привязан к процессу "${plan.linked}": он ждёт готовности и получает ${plan.applied.env.join(', ')}.`)
  } else if (plan.linked) {
    out.push('', `  Привязан к процессу "${plan.linked}": он ждёт готовности этого ресурса.`)
  } else if (plan.candidates.length > 1) {
    out.push(
      '',
      `  Ни к чему не привязан — процессов проекта несколько: ${plan.candidates.join(', ')}.`,
      `  Привязать: p3k add ${plan.resource.id} --link <процесс>`,
    )
  } else if (plan.candidates.length === 0) {
    out.push('', '  Привязывать не к чему: кроме ресурсов, в конфиге пока нет процессов.')
  }

  if (plan.linked && plan.applied.kept.length > 0) {
    out.push(
      '',
      `  У процесса "${plan.linked}" уже заданы ${plan.applied.kept.join(', ')} — оставлены как были.`,
      `  Чтобы приложение ходило именно в "${plan.name}", поправьте их руками.`,
    )
  }

  if (busy.length > 0) out.push('', `  Внимание: ${busy.join('; ')} — добавлено по --force.`)

  if (plan.resource.requires === 'Docker') {
    const docker = await exec('docker', ['--version'], 5000)
    if (docker.missing) out.push('', '  Docker не найден в PATH — без него этот ресурс не поднимется.')
  }

  for (const note of plan.resource.notes) out.push('', `  ${note}`)

  if (!args.dryRun) out.push('', '  Дальше:', '    p3k dev')
  out.push('')

  process.stdout.write(out.join('\n'))
  return 0
}
