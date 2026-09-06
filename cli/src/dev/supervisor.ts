import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { exec } from '../util/exec.js'
import { listeners, probe } from '../util/net.js'
import type { DevConfig, ProcessSpec, Ready } from './config.js'
import { startupWaves, shutdownOrder } from './graph.js'
import { LogMux } from './log.js'

const READY_TIMEOUT = 30_000
const READY_POLL = 250
/**
 * Сколько ждать добровольного завершения перед принудительным снятием.
 *
 * На Windows нет переносимого способа послать дереву процессов сигнал вида
 * SIGTERM: `taskkill` без `/F` шлёт WM_CLOSE, который консольные приложения
 * попросту игнорируют. Поэтому мягкая попытка там короткая — она почти всегда
 * ни к чему не приводит, и растягивать её значит просто задерживать выход.
 */
const STOP_GRACE = process.platform === 'win32' ? 1_000 : 5_000
const STOP_COMMAND_TIMEOUT = 5_000
/** Одна попытка проверки готовности не должна быть длиннее шага опроса на много. */
const HTTP_TIMEOUT = 2_000

interface Running {
  spec: ProcessSpec
  child: ChildProcess
  /** Последние строки вывода — по ним срабатывает условие готовности вида { log }. */
  seen: string[]
  exited: boolean
  code: number | null
  /** Мы сами его гасим — значит, выход не считается падением. */
  stopping: boolean
}

export interface DevResult {
  code: number
  reason: string
}

export class Supervisor {
  private readonly running = new Map<string, Running>()
  private readonly log: LogMux
  private shuttingDown = false
  private failure: { name: string; code: number | null } | null = null
  private forced = false

  constructor(private readonly config: DevConfig) {
    this.log = new LogMux(config.processes.map((p) => p.name))
  }

  async run(): Promise<DevResult> {
    const waves = startupWaves(this.config.processes)

    this.log.banner('')
    this.log.system(`конфиг: ${this.config.file}`)
    this.log.system(`процессов: ${this.config.processes.length}, волн запуска: ${waves.length}`)

    const onSignal = () => this.requestShutdown('получен сигнал прерывания')
    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)

    try {
      for (const wave of waves) {
        if (this.shuttingDown) break
        for (const spec of wave) this.start(spec)

        const gated = await Promise.all(wave.map((spec) => this.awaitReady(spec)))
        const failed = gated.filter((g) => g !== null)
        if (failed.length > 0) {
          this.failure = { name: failed[0] as string, code: 1 }
          this.requestShutdown(`процесс "${failed[0]}" не пришёл в готовность`)
          break
        }
      }

      if (!this.shuttingDown) {
        this.log.system('всё поднято — Ctrl+C для остановки', 'info')
        await this.waitForEnd()
      }
    } finally {
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      await this.stopAll()
      this.log.flush()
    }

    if (this.failure) {
      return { code: this.failure.code ?? 1, reason: `процесс "${this.failure.name}" завершился с ошибкой` }
    }
    return { code: 0, reason: 'остановлено по запросу' }
  }

  private start(spec: ProcessSpec) {
    const cwd = spec.cwd ? join(this.config.root, spec.cwd) : this.config.root
    const child = spawn(spec.command, {
      cwd,
      shell: true,
      // Цвет включаем, только если он уместен: вывод дочерних процессов идёт
      // через наш stdout, и NO_COLOR должен уважаться всей цепочкой.
      env: { ...process.env, ...spec.env, ...colorEnv() },
      // На POSIX своя группа процессов: сигнал уйдёт всему дереву, а не только оболочке.
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const rec: Running = { spec, child, seen: [], exited: false, code: null, stopping: false }
    this.running.set(spec.name, rec)

    const onData = (buf: Buffer) => {
      const text = buf.toString()
      this.log.chunk(spec.name, text)
      // Держим ограниченное окно: условие { log } смотрит только на свежий вывод.
      rec.seen.push(text)
      if (rec.seen.length > 50) rec.seen.shift()
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)

    child.on('error', (e) => {
      this.log.system(`${spec.name}: не удалось запустить — ${e.message}`, 'fail')
      rec.exited = true
      rec.code = 1
      this.noteExit(rec)
    })

    child.on('exit', (code, signal) => {
      rec.exited = true
      rec.code = code ?? (signal ? 143 : 1)
      this.noteExit(rec)
    })

    this.log.system(`${spec.name}: запуск — ${spec.command}`)
  }

  /** Незапланированный выход роняет всё: продолжать без части системы бессмысленно. */
  private noteExit(rec: Running) {
    if (rec.stopping || this.shuttingDown) return
    if (rec.spec.oneShot && rec.code === 0) {
      this.log.system(`${rec.spec.name}: выполнен`)
      return
    }
    const bad = rec.code !== 0
    this.log.system(`${rec.spec.name}: завершился с кодом ${rec.code}`, bad ? 'fail' : 'warn')
    if (bad) this.failure = { name: rec.spec.name, code: rec.code }
    this.requestShutdown(`процесс "${rec.spec.name}" завершился сам`)
  }

  private requestShutdown(reason: string) {
    if (this.shuttingDown) {
      // Второй сигнал — значит, ждать больше не хотят.
      this.forced = true
      return
    }
    this.shuttingDown = true
    this.log.system(`останавливаемся: ${reason}`, 'warn')
  }

  private async awaitReady(spec: ProcessSpec): Promise<string | null> {
    const rec = this.running.get(spec.name)
    if (!rec) return spec.name
    if (!spec.ready && !spec.oneShot) return null

    const deadline = Date.now() + READY_TIMEOUT
    const what = spec.ready ? describeReady(spec.ready) : 'успешное завершение'

    while (Date.now() < deadline) {
      if (this.shuttingDown) return null
      if (rec.exited) {
        // Для одноразового процесса выход и есть готовность — если он успешен.
        if (spec.oneShot && !spec.ready) {
          if (rec.code === 0) return null
          this.log.system(`${spec.name}: завершился с кодом ${rec.code}`, 'fail')
          return spec.name
        }
        this.log.system(`${spec.name}: завершился, не дождавшись готовности (${what})`, 'fail')
        return spec.name
      }
      if (spec.ready && (await this.isReady(spec.ready, rec))) {
        this.log.system(`${spec.name}: готов (${what})`)
        return null
      }
      await sleep(READY_POLL)
    }

    this.log.system(`${spec.name}: не дождались готовности за ${READY_TIMEOUT / 1000}с (${what})`, 'fail')
    return spec.name
  }

  /** Запуск команды оболочкой в каталоге проекта. true — код выхода 0. */
  private shellSucceeds(command: string, spec: ProcessSpec): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(command, {
        cwd: spec.cwd ? join(this.config.root, spec.cwd) : this.config.root,
        shell: true,
        stdio: 'ignore',
      })
      const timer = setTimeout(() => {
        child.kill()
        resolve(false)
      }, HTTP_TIMEOUT)
      child.on('exit', (code) => {
        clearTimeout(timer)
        resolve(code === 0)
      })
      child.on('error', () => {
        clearTimeout(timer)
        resolve(false)
      })
    })
  }

  private async isReady(ready: Ready, rec: Running): Promise<boolean> {
    if ('delay' in ready) {
      await sleep(ready.delay)
      return true
    }
    if ('log' in ready) return rec.seen.join('').includes(ready.log)

    if ('exec' in ready) {
      // Единственный способ спросить саму службу, готова ли она: порт она может
      // открыть задолго до этого. Через оболочку и в каталоге проекта — иначе
      // рассыплются кавычки и не сработают конвейеры вида `... | grep ...`.
      return this.shellSucceeds(ready.exec, rec.spec)
    }

    if ('http' in ready) {
      try {
        const res = await fetch(ready.http, {
          signal: AbortSignal.timeout(HTTP_TIMEOUT),
          redirect: 'manual',
        })
        // Ждём не конкретной страницы, а признака жизни: 5xx означает, что
        // служба поднялась, но ещё не обслуживает.
        return ready.status === undefined ? res.status < 500 : res.status === ready.status
      } catch {
        return false
      }
    }

    // Сначала соединением — это прямое доказательство. Если проба заблокирована
    // локальной политикой, отступаем к таблице сокетов: она хотя бы честно
    // говорит, открыт ли слушающий сокет.
    const [v4, v6] = await Promise.all([probe('127.0.0.1', ready.port, 400), probe('::1', ready.port, 400)])
    if (v4 === 'open' || v6 === 'open') return true
    if (v4 === 'refused' && v6 === 'refused') return false
    return (await listeners(ready.port)).length > 0
  }

  /** Ждём, пока кто-нибудь не завершится или не попросят остановиться. */
  private async waitForEnd(): Promise<void> {
    while (!this.shuttingDown) {
      if ([...this.running.values()].every((r) => r.exited)) return
      await sleep(200)
    }
  }

  /**
   * Команда остановки: единственный способ убрать то, что переживает процесс.
   *
   * Выполняется через оболочку и в каталоге проекта — ровно как основная
   * команда. Разбивать строку по пробелам нельзя: кавычки и пути с пробелами
   * от такого разбора рассыпаются.
   */
  private async runStop(spec: ProcessSpec): Promise<void> {
    if (!spec.stop) return
    this.log.system(`${spec.name}: ${spec.stop}`)

    await new Promise<void>((resolve) => {
      const child = spawn(spec.stop as string, {
        cwd: spec.cwd ? join(this.config.root, spec.cwd) : this.config.root,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const onData = (b: Buffer) => this.log.chunk(spec.name, b.toString())
      child.stdout?.on('data', onData)
      child.stderr?.on('data', onData)

      const timer = setTimeout(() => {
        child.kill()
        this.log.system(`${spec.name}: команда остановки не уложилась в ${STOP_COMMAND_TIMEOUT / 1000}с`, 'warn')
        resolve()
      }, STOP_COMMAND_TIMEOUT)

      const done = () => {
        clearTimeout(timer)
        resolve()
      }
      child.on('exit', done)
      child.on('error', (e) => {
        this.log.system(`${spec.name}: остановка не запустилась — ${e.message}`, 'warn')
        done()
      })
    })
  }

  private async stopAll(): Promise<void> {
    const order = shutdownOrder(this.config.processes)
    for (const spec of order) {
      const rec = this.running.get(spec.name)
      if (!rec) continue

      if (rec.exited) {
        // Процесс завершился, но мог оставить за собой внешнее состояние:
        // `docker compose up -d` выходит сразу, а контейнеры продолжают жить.
        // Поэтому команду остановки выполняем и для уже вышедших.
        await this.runStop(spec)
        continue
      }

      rec.stopping = true

      if (spec.stop) {
        await this.runStop(spec)
        if (await this.waitExit(rec, 1500)) continue
      }

      await this.terminate(rec, false)
      if (await this.waitExit(rec, this.forced ? 300 : STOP_GRACE)) {
        this.log.system(`${spec.name}: остановлен`)
        continue
      }

      // На Windows это обычный путь, а не тревога: см. комментарий к STOP_GRACE.
      this.log.system(
        `${spec.name}: снимаем дерево процессов принудительно`,
        process.platform === 'win32' ? 'info' : 'warn',
      )
      await this.terminate(rec, true)
      await this.waitExit(rec, 2000)
    }
  }

  /**
   * Убийство всего дерева, а не только оболочки.
   *
   * `shell: true` означает, что прямой потомок — это cmd.exe или sh, а реальная
   * работа идёт во внуках. Убить одного потомка недостаточно: именно так после
   * Ctrl+C остаются висеть занятые порты и контейнеры.
   */
  private async terminate(rec: Running, force: boolean): Promise<void> {
    const pid = rec.child.pid
    if (pid === undefined) return

    if (process.platform === 'win32') {
      await exec('taskkill', force ? ['/PID', String(pid), '/T', '/F'] : ['/PID', String(pid), '/T'], 4000)
      return
    }
    try {
      // Отрицательный pid — вся группа процессов.
      process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM')
    } catch {
      try {
        rec.child.kill(force ? 'SIGKILL' : 'SIGTERM')
      } catch {
        /* процесс уже исчез */
      }
    }
  }

  private async waitExit(rec: Running, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (rec.exited) return true
      await sleep(100)
    }
    return rec.exited
  }
}

/** Дочерние процессы по умолчанию видят пайп и глушат цвет — возвращаем его, если он нужен. */
function colorEnv(): Record<string, string> {
  if (process.env.NO_COLOR) return {}
  if (process.env.FORCE_COLOR) return { FORCE_COLOR: process.env.FORCE_COLOR }
  return process.stdout.isTTY ? { FORCE_COLOR: '1' } : {}
}

function describeReady(ready: Ready): string {
  if ('port' in ready) return `порт ${ready.port}`
  if ('http' in ready) return ready.status === undefined ? `ответ ${ready.http}` : `${ready.http} → ${ready.status}`
  if ('exec' in ready) return `успех "${ready.exec}"`
  if ('log' in ready) return `строка "${ready.log}" в выводе`
  return `пауза ${ready.delay}мс`
}
