import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigError, findConfig, readConfigJson } from '../config.js'
import { findRoot, projectName } from '../util/project.js'
import { readResources } from '../add/plan.js'
import { envExample, planCompose, unfilled, type ComposePlan } from './compose.js'
import { shell } from '../util/exec.js'
import { runCheck } from '../check/index.js'
import { loadDeploy, uniqueRelease, RELEASE_ID, type DeployConfig, type Health } from './config.js'
import { LocalTarget, SshTarget, type Target } from './target.js'

export const SHIP_HELP = `
  p3k ship — выкатить проект на сервер

  Использование:
    p3k ship [опции]

  Опции:
    --to <user@host>  цель поверх той, что в конфиге
    --dry-run         показать план и проверить связь, ничего не менять
    --skip-checks     не прогонять check перед выкаткой
    --no-rollback     не откатываться, если проверка здоровья не прошла
    --rollback        вернуться на предыдущий выпуск и выйти
    --releases        показать выпуски на цели
    --help            эта справка

  Выпуск заливается рядом с работающим, и только потом ссылка current
  переключается на него. Поэтому откат — это переключение ссылки обратно,
  а не повторная выкатка.
`

interface Args {
  to: string | null
  dryRun: boolean
  skipChecks: boolean
  rollback: boolean
  noRollback: boolean
  releases: boolean
  help: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    to: null,
    dryRun: false,
    skipChecks: false,
    rollback: false,
    noRollback: false,
    releases: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') args.help = true
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--skip-checks') args.skipChecks = true
    else if (a === '--rollback') args.rollback = true
    else if (a === '--no-rollback') args.noRollback = true
    else if (a === '--releases') args.releases = true
    else if (a === '--to') args.to = argv[++i] ?? null
  }
  return args
}

/**
 * Куда команда пишет.
 *
 * Подменяемо не ради красоты: выкатку хочется проверять целиком, а тест,
 * который перехватывает process.stdout, заодно глушит и отчёт самого прогона.
 */
export interface ShipIo {
  out(text: string): void
  err(text: string): void
}

class Report {
  constructor(private readonly io: ShipIo) {}
  line(s = '') {
    this.io.out(`${s}\n`)
  }
  step(s: string) {
    this.line(`  · ${s}`)
  }
  done(s: string) {
    this.line(`  ✓ ${s}`)
  }
  bad(s: string) {
    this.line(`  ✗ ${s}`)
  }
  fail(s: string) {
    this.io.err(s)
  }
}

const since = (t: number) => `${((Date.now() - t) / 1000).toFixed(1)} с`

const DEPLOY_STUB = `
  Добавьте в p3k.json примерно такое и поправьте под себя:

  "deploy": {
    "host": "root@ваш-сервер",
    "path": "/srv/приложение",
    "build": "npm run build",
    "upload": ["dist", "package.json", "package-lock.json"],
    "release": "npm ci --omit=dev",
    "restart": "systemctl restart приложение",
    "health": "https://ваш-домен/health"
  }

  Обязательны только path и upload. Без host целью будет эта же машина —
  так удобно посмотреть, что получится, ничего не трогая на сервере.
`


/** Последние строки чужого вывода — их обычно достаточно, чтобы понять причину. */
function tail(text: string, lines = 6): string {
  const kept = text.trim().split('\n').slice(-lines)
  return kept.map((l) => `      ${l}`).join('\n')
}

/**
 * Ждём, пока приложение ответит.
 *
 * Сразу после перезапуска отказ — это норма: служба ещё поднимается. Поэтому
 * опрашиваем до истечения срока и только тогда считаем выпуск негодным.
 */
async function waitHealthy(health: Health): Promise<{ ok: boolean; detail: string }> {
  const deadline = Date.now() + health.timeout * 1000
  let last = 'ответа не было'

  for (;;) {
    try {
      const res = await fetch(health.url, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
      const good = health.status === undefined ? res.status < 500 : res.status === health.status
      if (good) return { ok: true, detail: `${res.status}` }
      last = `статус ${res.status}`
    } catch (e) {
      last = e instanceof Error ? e.message : String(e)
    }
    if (Date.now() >= deadline) return { ok: false, detail: `${last} за ${health.timeout} с` }
    await new Promise((r) => setTimeout(r, 1000))
  }
}

interface Paths {
  base: string
  releases: string
  current: string
  /** Всё, что переживает выпуски: compose, секреты, конфиг прокси. */
  shared: string
}

const paths = (t: Target, base: string): Paths => ({
  base,
  releases: t.join(base, 'releases'),
  current: t.join(base, 'current'),
  shared: t.join(base, 'shared'),
})

/**
 * Поднять ресурсы проекта на сервере.
 *
 * Секреты остаются на сервере: мы отправляем только compose, а пароли берём из
 * shared/.env, который человек заполняет один раз сам. Поэтому первый запуск
 * заканчивается отказом с готовым списком переменных — это не ошибка, а
 * единственный шаг, который нельзя сделать за него.
 */
async function bringUpResources(
  t: Target,
  p: Paths,
  plan: ComposePlan,
  project: string,
  r: Report,
): Promise<boolean> {
  const envPath = t.join(p.shared, '.env')
  const stage = mkdtempSync(join(tmpdir(), 'p3k-shared-'))
  const names = ['compose.yml', ...Object.keys(plan.files)]

  writeFileSync(join(stage, 'compose.yml'), plan.yaml)
  for (const [name, content] of Object.entries(plan.files)) writeFileSync(join(stage, name), content)

  await t.mkdir(p.shared)

  if (!(await t.exists(envPath))) {
    writeFileSync(join(stage, '.env.example'), envExample(plan.env))
    await t.upload(stage, [...names, '.env.example'], p.shared)
    r.bad(`на сервере нет ${envPath} — без него службы не поднять`)
    r.line()
    r.line(`  Рядом положен .env.example. На сервере:`)
    r.line(`    cp ${envPath}.example ${envPath} && nano ${envPath}`)
    r.line(`  Заполнить нужно: ${unfilled(plan.env).join(', ') || 'ничего, файла просто не было'}`)
    r.line()
    return false
  }

  await t.upload(stage, names, p.shared)

  const compose =
    `docker compose -p ${project} --env-file ${t.join(p.shared, '.env')} ` +
    `-f ${t.join(p.shared, 'compose.yml')} up -d --wait --remove-orphans`
  const res = await t.run(compose, p.shared)
  if (!res.ok) {
    r.bad(`службы не поднялись:
${tail(res.stderr || res.stdout)}`)
    return false
  }
  r.done(`службы подняты: ${plan.services.join(', ')}`)
  return true
}

/** Выпуски на цели, от старых к новым. Имена — время, поэтому сортировка совпадает. */
async function releases(t: Target, p: Paths): Promise<string[]> {
  const names = await t.list(p.releases)
  return names.filter((n) => RELEASE_ID.test(n)).sort()
}

/** Имя выпуска, на который сейчас смотрит current. */
async function currentRelease(t: Target, p: Paths): Promise<string | null> {
  const link = await t.readLink(p.current)
  if (!link) return null
  const name = link.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? null
  return name && RELEASE_ID.test(name) ? name : null
}

async function switchTo(t: Target, p: Paths, deploy: DeployConfig, name: string): Promise<void> {
  await t.link(t.join(p.releases, name), p.current)
  if (deploy.restart) {
    const res = await t.run(deploy.restart, p.current)
    if (!res.ok) throw new Error(`перезапуск не отработал:\n${tail(res.stderr || res.stdout)}`)
  }
}

async function showReleases(t: Target, p: Paths, r: Report): Promise<number> {
  const list = await releases(t, p)
  const active = await currentRelease(t, p)

  r.line()
  r.line(`  ${t.describe()}: ${p.base}`)
  r.line()
  if (list.length === 0) r.line('  выпусков нет')
  for (const name of [...list].reverse()) r.line(`  ${name === active ? '→' : ' '} ${name}`)
  r.line()
  return 0
}

async function rollback(t: Target, p: Paths, deploy: DeployConfig, r: Report): Promise<number> {
  const list = await releases(t, p)
  const active = await currentRelease(t, p)
  const index = active ? list.indexOf(active) : -1

  if (index <= 0) {
    r.fail(
      active === null
        ? 'ship: current никуда не указывает — откатываться не с чего\n'
        : `ship: ${active} — самый ранний выпуск на цели, откатываться некуда\n`,
    )
    return 1
  }

  const target = list[index - 1] as string
  r.line()
  r.line(`  откат: ${active} → ${target}`)
  await switchTo(t, p, deploy, target)
  r.done(`current указывает на ${target}`)

  if (deploy.health) {
    const health = await waitHealthy(deploy.health)
    if (health.ok) r.done(`здоров (${deploy.health.url} → ${health.detail})`)
    else r.bad(`не отвечает: ${health.detail} — предыдущий выпуск тоже нездоров`)
    r.line()
    return health.ok ? 0 : 1
  }
  r.line()
  return 0
}

const CONSOLE: ShipIo = {
  out: (text) => void process.stdout.write(text),
  err: (text) => void process.stderr.write(text),
}

export async function runShip(argv: string[], io: ShipIo = CONSOLE): Promise<number> {
  const args = parseArgs(argv)
  const r = new Report(io)
  if (args.help) {
    process.stdout.write(SHIP_HELP)
    return 0
  }

  const root = findRoot(process.cwd())
  const file = findConfig(root)
  if (!file) {
    r.fail(`ship: в ${root} нет p3k.json — описывать выкатку негде\n`)
    return 2
  }

  let deploy: DeployConfig
  try {
    deploy = loadDeploy(file)
  } catch (e) {
    r.fail(`ship: ${e instanceof ConfigError ? e.message : String(e)}\n`)
    // Заготовку печатаем, а не дописываем в конфиг: адрес сервера и путь на нём
    // знает только человек, а конфиг с выдуманным хостом хуже, чем никакого.
    if (e instanceof ConfigError && /нет секции deploy/.test(e.message)) r.fail(DEPLOY_STUB)
    return 2
  }

  const project = projectName(root)
  const composePlan = deploy.resources ? planCompose(readResources(readConfigJson(file)), project) : null

  const host = args.to ?? deploy.host
  const target: Target = host ? new SshTarget(host, deploy.ssh) : new LocalTarget()
  const p = paths(target, deploy.path)

  // Связь проверяем до всего остального: собирать проект десять минут, чтобы
  // потом узнать про недоступный сервер, — худший из возможных порядков.
  const hello = await target.probe()
  if (!hello.ok) {
    r.fail(
      `ship: не достучались до цели ${target.describe()}\n` +
        `${tail(hello.stderr || hello.stdout || `код ${hello.code}`)}\n` +
        (target.kind === 'ssh'
          ? '     ssh запускается без пароля (BatchMode) — нужен ключ; проверьте: ssh ' + host + ' true\n'
          : ''),
    )
    return 1
  }

  if (args.releases) return showReleases(target, p, r)
  if (args.rollback) return rollback(target, p, deploy, r)

  const name = uniqueRelease(await releases(target, p))
  const dir = target.join(p.releases, name)
  const previous = await currentRelease(target, p)

  r.line()
  r.line(`  ${target.describe()} · ${p.base}`)
  r.line(`  выпуск ${name}${previous ? ` · сейчас работает ${previous}` : ' · первый на этой цели'}`)
  r.line()

  if (args.dryRun) {
    r.line('  План:')
    if (deploy.checks && !args.skipChecks) r.line('    check — проверки проекта')
    if (deploy.build) r.line(`    сборка: ${deploy.build}`)
    r.line(`    отправка: ${deploy.upload.join(', ')} → ${dir}`)
    if (composePlan) {
      r.line(`    службы: ${composePlan.services.join(', ')} → ${target.join(p.shared, 'compose.yml')}`)
      if (composePlan.skipped.length > 0) r.line(`    в прод не поедет: ${composePlan.skipped.join(', ')}`)
    }
    if (deploy.release) r.line(`    в выпуске: ${deploy.release}`)
    r.line(`    переключение: ${p.current} → ${dir}`)
    if (deploy.restart) r.line(`    перезапуск: ${deploy.restart}`)
    if (deploy.health) r.line(`    здоровье: ${deploy.health.url} (до ${deploy.health.timeout} с)`)
    r.line(`    хранить выпусков: ${deploy.keep}`)
    r.line()
    r.line('  Связь с целью есть. Ничего не изменено.')
    r.line()
    return 0
  }

  if (deploy.checks && !args.skipChecks) {
    const code = await runCheck([])
    if (code !== 0) {
      r.fail('\nship: проверки не прошли — выкатка отменена (обойти: --skip-checks)\n')
      return code
    }
  }

  if (deploy.build) {
    const t0 = Date.now()
    r.step(`сборка: ${deploy.build}`)
    const res = await shell(deploy.build, { cwd: root, timeout: 30 * 60_000 })
    if (!res.ok) {
      r.bad(`сборка упала\n${tail(res.stderr || res.stdout)}`)
      return 1
    }
    r.done(`собрано за ${since(t0)}`)
  }

  for (const path of deploy.upload) {
    if (!existsSync(join(root, path))) {
      r.bad(`нечего отправлять: в проекте нет "${path}"`)
      return 1
    }
  }

  try {
    const t0 = Date.now()
    await target.mkdir(dir)
    await target.upload(root, deploy.upload, dir)
    r.done(`отправлено за ${since(t0)}: ${deploy.upload.join(', ')}`)
  } catch (e) {
    r.bad(e instanceof Error ? e.message : String(e))
    return 1
  }

  if (composePlan) {
    if (composePlan.skipped.length > 0) {
      r.line(`  · в прод не поедет: ${composePlan.skipped.join(', ')}`)
    }
    const up = await bringUpResources(target, p, composePlan, project, r)
    if (!up) {
      r.line(`  Ничего не переключено — продолжает работать ${previous ?? 'то, что работало'}.`)
      r.line()
      return 1
    }
  }

  if (deploy.release) {
    const t0 = Date.now()
    r.step(`в выпуске: ${deploy.release}`)
    const res = await target.run(deploy.release, dir)
    if (!res.ok) {
      // Ссылку ещё не переключали, поэтому убирать за собой нечего: работает
      // прежний выпуск, а негодный остаётся на месте для разбора.
      r.bad(`не отработало:\n${tail(res.stderr || res.stdout)}`)
      r.line()
      r.line(`  Ничего не переключено — продолжает работать ${previous ?? 'то, что работало'}.`)
      r.line(`  Неудавшийся выпуск остался в ${dir}`)
      r.line()
      return 1
    }
    r.done(`выполнено за ${since(t0)}`)
  }

  try {
    await switchTo(target, p, deploy, name)
    r.done(`current → ${name}${deploy.restart ? ', служба перезапущена' : ''}`)
  } catch (e) {
    r.bad(e instanceof Error ? e.message : String(e))
    return 1
  }

  if (deploy.health) {
    const t0 = Date.now()
    r.step(`здоровье: ${deploy.health.url}`)
    const health = await waitHealthy(deploy.health)

    if (!health.ok) {
      r.bad(`не отвечает: ${health.detail}`)

      if (args.noRollback || !previous) {
        r.line()
        r.line(
          previous
            ? '  Откат отключён — на цели остался нездоровый выпуск.'
            : '  Откатываться не на что: это первый выпуск на этой цели.',
        )
        r.line(`  Вернуться руками: p3k ship --rollback`)
        r.line()
        return 1
      }

      r.line(`  ↩ откат на ${previous}`)
      try {
        await switchTo(target, p, deploy, previous)
      } catch (e) {
        r.bad(`откат не удался: ${e instanceof Error ? e.message : String(e)}`)
        return 1
      }
      const back = await waitHealthy(deploy.health)
      if (back.ok) r.done(`откатились, ${previous} отвечает (${back.detail})`)
      else r.bad(`откатились, но ${previous} тоже не отвечает: ${back.detail}`)
      r.line()
      r.line(`  Негодный выпуск остался в ${dir} — можно посмотреть логи.`)
      r.line()
      return 1
    }
    r.done(`здоров за ${since(t0)} (${deploy.health.url} → ${health.detail})`)
  }

  // Чистим только заведомо ненужное: текущий и предыдущий выпуски трогать
  // нельзя — на них держится откат.
  const all = await releases(target, p)
  const keep = new Set([name, ...(previous ? [previous] : []), ...all.slice(-deploy.keep)])
  const stale = all.filter((r) => !keep.has(r))
  for (const old of stale) await target.remove(target.join(p.releases, old))
  if (stale.length > 0) r.done(`убрано старых выпусков: ${stale.length}`)

  r.line()
  r.line(`  выкачено: ${name}`)
  if (previous) r.line(`  откатиться: p3k ship --rollback  →  ${previous}`)
  r.line()
  return 0
}
