import { spawn } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { dirname, join as joinNative, resolve } from 'node:path'
import { shell, type ExecResult } from '../util/exec.js'

/**
 * Цель выкатки: сервер по SSH или каталог на этой же машине.
 *
 * Вся логика выпусков — создать каталог, залить, переключить ссылку, откатить —
 * написана поверх этого интерфейса и одинакова для обеих целей. Локальная цель
 * не игрушечная: она нужна, чтобы порядок шагов и откат можно было проверить
 * целиком, не имея сервера, — и потому проверяется теми же тестами.
 */
export interface Target {
  readonly kind: 'ssh' | 'local'
  describe(): string
  /** Есть ли связь с целью. Проверяется до сборки: узнавать о недоступном
   *  сервере после десяти минут сборки — худший из возможных порядков. */
  probe(): Promise<ExecResult>
  /** Склейка путей на стороне цели. */
  join(...parts: string[]): string
  run(command: string, cwd?: string): Promise<ExecResult>
  mkdir(dir: string): Promise<void>
  /** Отправить пути (относительно root) внутрь каталога dest на цели. */
  upload(root: string, paths: string[], dest: string): Promise<void>
  /** Переключить ссылку link на каталог target. */
  link(target: string, link: string): Promise<void>
  /** Куда указывает ссылка сейчас, или null, если её нет. */
  readLink(link: string): Promise<string | null>
  list(dir: string): Promise<string[]>
  remove(path: string): Promise<void>
  exists(path: string): Promise<boolean>
}

/** Строка в одинарных кавычках для POSIX-оболочки на сервере. */
export const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

function run(cmd: string, args: string[], stdin?: NodeJS.ReadableStream): Promise<ExecResult> {
  return new Promise((resolve_) => {
    // Без shell: команду для сервера собираем сами и передаём одним аргументом,
    // иначе её пришлось бы кавычить дважды — под локальную оболочку и под
    // удалённую, а на Windows локальная ещё и другая.
    const child = spawn(cmd, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    if (stdin) stdin.pipe(child.stdin)
    child.on('error', (e) =>
      resolve_({ ok: false, code: 1, stdout, stderr: stderr + String(e), missing: (e as { code?: string }).code === 'ENOENT' }),
    )
    child.on('close', (code) => resolve_({ ok: code === 0, code, stdout, stderr, missing: false }))
  })
}

export class SshTarget implements Target {
  readonly kind = 'ssh'

  constructor(
    private readonly host: string,
    private readonly options: string[] = [],
  ) {}

  describe(): string {
    return this.options.length > 0 ? `${this.host} (ssh ${this.options.join(' ')})` : this.host
  }

  join(...parts: string[]): string {
    return parts.join('/').replace(/\/+/g, '/')
  }

  private args(): string[] {
    // BatchMode: без него ssh при неподошедшем ключе спросит пароль, а спросить
    // некого — вывод перехвачен, и команда просто зависнет.
    return ['-o', 'BatchMode=yes', ...this.options, this.host]
  }

  async probe(): Promise<ExecResult> {
    return this.run('true')
  }

  async run(command: string, cwd?: string): Promise<ExecResult> {
    const full = cwd ? `cd ${q(cwd)} && ${command}` : command
    return run('ssh', [...this.args(), full])
  }

  async mkdir(dir: string): Promise<void> {
    const res = await this.run(`mkdir -p ${q(dir)}`)
    if (!res.ok) throw new Error(`не создали каталог ${dir}: ${res.stderr.trim() || res.stdout.trim()}`)
  }

  async upload(root: string, paths: string[], dest: string): Promise<void> {
    const tar = spawn('tar', ['-czf', '-', '-C', root, ...paths], { windowsHide: true })
    let tarErr = ''
    tar.stderr.on('data', (d: Buffer) => (tarErr += d.toString()))

    const res = await run('ssh', [...this.args(), `tar -xzf - -C ${q(dest)}`], tar.stdout)
    if (!res.ok) {
      throw new Error(`не отправили файлы: ${(res.stderr || tarErr).trim() || `код ${res.code}`}`)
    }
  }

  async link(target: string, link: string): Promise<void> {
    // Переключение одним mv: ln -sfn сначала удаляет ссылку, и между удалением
    // и созданием сайт отвечал бы 404.
    const tmp = `${link}.new`
    const res = await this.run(`ln -sfn ${q(target)} ${q(tmp)} && mv -Tf ${q(tmp)} ${q(link)}`)
    if (!res.ok) throw new Error(`не переключили ${link}: ${res.stderr.trim() || res.stdout.trim()}`)
  }

  async readLink(link: string): Promise<string | null> {
    const res = await this.run(`readlink ${q(link)}`)
    const value = res.stdout.trim()
    return res.ok && value !== '' ? value : null
  }

  async list(dir: string): Promise<string[]> {
    const res = await this.run(`ls -1 ${q(dir)} 2>/dev/null || true`)
    return res.stdout.split('\n').map((l) => l.trim()).filter((l) => l !== '')
  }

  async remove(path: string): Promise<void> {
    await this.run(`rm -rf ${q(path)}`)
  }

  async exists(path: string): Promise<boolean> {
    return (await this.run(`test -e ${q(path)}`)).ok
  }
}

/**
 * Ссылка на месте — даже если она никуда не ведёт.
 *
 * existsSync идёт по ссылке и на повисшей возвращает false, после чего
 * переименование упало бы с «файл уже существует».
 */
function linkPresent(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/** Снять ссылку, не тронув то, на что она указывает. */
function unlink(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    // На Windows каталожная связь снимается только как каталог.
    rmdirSync(path)
  }
}

export class LocalTarget implements Target {
  readonly kind = 'local'

  describe(): string {
    return 'эта машина'
  }

  join(...parts: string[]): string {
    return joinNative(...parts)
  }

  async probe(): Promise<ExecResult> {
    // Идти некуда: цель — эта же машина.
    return { ok: true, code: 0, stdout: '', stderr: '', missing: false }
  }

  async run(command: string, cwd?: string): Promise<ExecResult> {
    return shell(command, { cwd, timeout: 10 * 60_000 })
  }

  async mkdir(dir: string): Promise<void> {
    mkdirSync(dir, { recursive: true })
  }

  async upload(root: string, paths: string[], dest: string): Promise<void> {
    for (const p of paths) {
      const from = resolve(root, p)
      if (!existsSync(from)) throw new Error(`нечего отправлять: в проекте нет "${p}"`)
      const to = joinNative(dest, p)
      // Путь может быть вложенным (src/server.mjs): каталог под него нужно
      // создать самим, копирование одиночного файла этого не делает.
      mkdirSync(dirname(to), { recursive: true })
      cpSync(from, to, { recursive: true })
    }
  }

  async link(target: string, link: string): Promise<void> {
    const tmp = `${link}.new`
    if (linkPresent(tmp)) unlink(tmp)
    // junction вместо симлинка: на Windows обычная символическая ссылка
    // требует прав администратора, а связь каталогов — нет.
    symlinkSync(target, tmp, process.platform === 'win32' ? 'junction' : 'dir')
    try {
      renameSync(tmp, link)
    } catch {
      if (linkPresent(link)) unlink(link)
      renameSync(tmp, link)
    }
  }

  async readLink(link: string): Promise<string | null> {
    try {
      if (!lstatSync(link).isSymbolicLink()) return null
      return readlinkSync(link)
    } catch {
      return null
    }
  }

  async list(dir: string): Promise<string[]> {
    try {
      return readdirSync(dir)
    } catch {
      return []
    }
  }

  async remove(path: string): Promise<void> {
    rmSync(path, { recursive: true, force: true })
  }

  async exists(path: string): Promise<boolean> {
    return existsSync(path)
  }
}
