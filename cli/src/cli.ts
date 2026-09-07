#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { runInit } from './init/index.js'
import { runAdd } from './add/index.js'
import { runShip } from './ship/index.js'
import { runCheck } from './check/index.js'
import { runDoctor } from './doctor/index.js'
import { runDev } from './dev/index.js'

const HELP = `
  p3k — путь проекта от пустой папки до продакшена

  Команды:
    init      каркас проекта и конфиг, с которого начинается всё остальное
    add       добавить проекту ресурс: базу, кэш, хранилище, прокси
    dev       поднять окружение проекта одной командой
    check     прогнать проверки проекта до того, как это сделает CI
    ship      выкатить проект на сервер, с проверкой здоровья и откатом
    doctor    выяснить, почему проект не поднимается

  Справка по команде: p3k <команда> --help
`

/** Версию берём из манифеста пакета: две записи рано или поздно разъезжаются. */
function version(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version?: string
    }
    return pkg.version ?? 'неизвестна'
  } catch {
    return 'неизвестна'
  }
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2)

  switch (command) {
    case 'init':
      return runInit(rest)
    case 'add':
      return runAdd(rest)
    case 'dev':
      return runDev(rest)
    case 'check':
      return runCheck(rest)
    case 'ship':
      return runShip(rest)
    case 'doctor':
      return runDoctor(rest)
    case undefined:
    case '--help':
    case '-h':
      process.stdout.write(HELP)
      return 0
    case '--version':
    case '-v':
      process.stdout.write(`${version()}\n`)
      return 0
    default:
      process.stderr.write(`p3k: неизвестная команда "${command}"\n${HELP}`)
      return 2
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`p3k: ${e instanceof Error ? e.stack : String(e)}\n`)
    process.exit(2)
  },
)
