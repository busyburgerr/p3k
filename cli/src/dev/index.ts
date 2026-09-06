import { listeners } from '../util/net.js'
import { findRoot } from '../util/project.js'
import { ConfigError, findConfig, loadConfig, CONFIG_NAMES, type DevConfig } from './config.js'
import { CycleError } from './graph.js'
import { Supervisor } from './supervisor.js'

export const DEV_HELP = `
  p3k dev — поднять окружение проекта одной командой

  Использование:
    p3k dev [каталог] [опции]

  Опции:
    --only <имя>  запустить только этот процесс и то, от чего он зависит
                  (можно повторять)
    --help        эта справка

  Процессы описываются в ${CONFIG_NAMES[0]}:

    {
      "processes": {
        "db":  { "command": "docker run --rm --name pg -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:16",
                 "ready": { "exec": "docker exec pg pg_isready -U postgres" },
                 "stop": "docker stop pg" },
        "api": { "command": "npm run dev", "cwd": "api",
                 "needs": ["db"], "ready": { "http": "http://localhost:4000/health" } },
        "web": { "command": "npm run dev",
                 "needs": ["api"], "ready": { "log": "ready in" } }
      }
    }

  Ctrl+C гасит всё дерево процессов в обратном порядке зависимостей.
`

interface Args {
  dir: string
  only: string[]
  help: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dir: process.cwd(), only: [], help: false }
  let dirSeen = false

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') args.help = true
    else if (a === '--only') {
      const name = argv[++i]
      if (name) args.only.push(name)
    } else if (a && !a.startsWith('-') && !dirSeen) {
      args.dir = a
      dirSeen = true
    }
  }
  return args
}

/** Оставляем названные процессы вместе со всем, от чего они зависят. */
function narrow(config: DevConfig, only: string[]): DevConfig {
  const byName = new Map(config.processes.map((p) => [p.name, p]))
  const unknown = only.filter((n) => !byName.has(n))
  if (unknown.length > 0) {
    throw new ConfigError(`нет процессов: ${unknown.join(', ')}. Доступны: ${[...byName.keys()].join(', ')}`)
  }

  const keep = new Set<string>()
  const visit = (name: string) => {
    if (keep.has(name)) return
    keep.add(name)
    byName.get(name)?.needs.forEach(visit)
  }
  only.forEach(visit)

  return { ...config, processes: config.processes.filter((p) => keep.has(p.name)) }
}

/**
 * Порты проверяются до запуска: занятый порт даёт внятную строку здесь,
 * а не невнятную ошибку изнутри чужого процесса через десять секунд.
 */
async function checkPorts(config: DevConfig): Promise<string[]> {
  const problems: string[] = []
  for (const p of config.processes) {
    if (!p.ready || !('port' in p.ready)) continue
    const found = await listeners(p.ready.port)
    if (found.length === 0) continue
    const who = found.map((l) => `${l.process ?? 'процесс'}${l.pid ? ` (PID ${l.pid})` : ''}`).join(', ')
    problems.push(`порт ${p.ready.port} для "${p.name}" уже занят: ${who}`)
  }
  return problems
}

export async function runDev(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  if (args.help) {
    process.stdout.write(DEV_HELP)
    return 0
  }

  const root = findRoot(args.dir)
  const file = findConfig(root)
  if (!file) {
    process.stderr.write(
      `dev: в ${root} нет файла конфигурации (${CONFIG_NAMES.join(' или ')})\n` +
        `     запустите "p3k dev --help", чтобы увидеть пример\n`,
    )
    return 2
  }

  let config: DevConfig
  try {
    config = loadConfig(root, file)
    if (args.only.length > 0) config = narrow(config, args.only)
  } catch (e) {
    if (e instanceof ConfigError) {
      process.stderr.write(`dev: ${e.message}\n`)
      return 2
    }
    throw e
  }

  const busy = await checkPorts(config)
  if (busy.length > 0) {
    for (const line of busy) process.stderr.write(`dev: ${line}\n`)
    process.stderr.write('     освободите порт или запустите "p3k doctor" для подробностей\n')
    return 2
  }

  try {
    const result = await new Supervisor(config).run()
    process.stdout.write(`\n  ${result.reason}\n\n`)
    return result.code
  } catch (e) {
    if (e instanceof CycleError) {
      process.stderr.write(`dev: ${e.message}\n`)
      return 2
    }
    throw e
  }
}
