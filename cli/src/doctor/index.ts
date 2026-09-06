import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Check, Context, Finding, Level } from '../types.js'
import { findRoot, readJson, discoverPorts } from '../util/project.js'
import { renderHuman, renderJson, type GroupResult } from './report.js'
import { nodeCheck } from './checks/node.js'
import { dockerCheck } from './checks/docker.js'
import { portsCheck } from './checks/ports.js'
import { loopbackCheck } from './checks/loopback.js'
import { envCheck } from './checks/env.js'
import { peersCheck } from './checks/peers.js'
import { installCheck } from './checks/install.js'

export const DOCTOR_HELP = `
  p3k doctor — почему проект не поднимается

  Использование:
    p3k doctor [каталог] [опции]

  Опции:
    --port <n>    дополнительный порт для проверки (можно повторять)
    --json        машиночитаемый вывод
    --help        эта справка

  Код возврата: 1, если есть блокирующие проблемы, иначе 0.
`

interface Args {
  dir: string
  ports: number[]
  json: boolean
  help: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dir: process.cwd(), ports: [], json: false, help: false }
  let dirSeen = false

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') args.help = true
    else if (a === '--json') args.json = true
    else if (a === '--port') {
      const n = Number(argv[++i])
      if (Number.isInteger(n)) args.ports.push(n)
    } else if (a && !a.startsWith('-') && !dirSeen) {
      args.dir = a
      dirSeen = true
    }
  }
  return args
}

export async function runDoctor(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  if (args.help) {
    process.stdout.write(DOCTOR_HELP)
    return 0
  }

  const root = findRoot(args.dir)
  const pkg = readJson(join(root, 'package.json'))
  let files: string[] = []
  try {
    files = readdirSync(root)
  } catch {
    files = []
  }

  const ctx: Context = { root, pkg, ports: discoverPorts(root, args.ports) }
  const checks: Check[] = [nodeCheck, dockerCheck(files), portsCheck, loopbackCheck, envCheck, installCheck, peersCheck]

  const byGroup = new Map<string, Finding[]>()
  const counts: Record<Level, number> = { ok: 0, warn: 0, fail: 0, skip: 0 }
  const skipped: string[] = []

  for (const check of checks) {
    let findings: Finding[]
    try {
      findings = await check.run(ctx)
    } catch (e) {
      // Упавшая проверка не должна прятать результаты остальных.
      findings = [{
        level: 'skip',
        title: check.id,
        detail: `проверка завершилась ошибкой: ${e instanceof Error ? e.message : String(e)}`,
      }]
    }
    for (const f of findings) {
      counts[f.level]++
      if (f.level === 'skip') skipped.push(check.id)
      const list = byGroup.get(check.group) ?? []
      list.push(f)
      byGroup.set(check.group, list)
    }
  }

  const groups: GroupResult[] = [...byGroup.entries()].map(([group, findings]) => ({ group, findings }))
  const render = args.json ? renderJson : renderHuman
  process.stdout.write(render(groups, counts, [...new Set(skipped)]))

  return counts.fail > 0 ? 1 : 0
}
