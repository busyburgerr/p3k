import { execFile, spawn } from 'node:child_process'

export interface ExecResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  /** true, если исполняемый файл не найден в PATH. */
  missing: boolean
}

/**
 * Запуск внешней команды без shell: аргументы не проходят через интерпретатор,
 * поэтому подстановка из имён файлов и переменных окружения невозможна.
 */
export function exec(cmd: string, args: string[], timeout = 5000, cwd?: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      // execFile кладёт в code либо строку errno ('ENOENT'), либо код выхода.
      const code: unknown = err ? (err as { code?: unknown }).code : 0
      const missing = code === 'ENOENT' || code === 127
      resolve({
        ok: !err,
        code: typeof code === 'number' ? code : err ? 1 : 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
        missing,
      })
    })
  })
}

/**
 * Запуск строки через оболочку.
 *
 * Нужен там, где команду пишет человек и ждёт от неё привычного поведения:
 * конвейеры, подстановки, кавычки. Разбирать такую строку самим и звать
 * execFile — значит делать вид, что мы оболочка, и расходиться с ней на первом
 * же нетривиальном случае.
 */
export function shell(
  command: string,
  opts: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv; input?: string } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd: opts.cwd,
      env: opts.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timer: NodeJS.Timeout | undefined
    if (opts.timeout) timer = setTimeout(() => child.kill('SIGKILL'), opts.timeout)

    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))
    child.stdin?.on('error', () => {})
    if (opts.input !== undefined) child.stdin?.end(opts.input)
    else child.stdin?.end()

    const done = (code: number | null) => {
      if (timer) clearTimeout(timer)
      resolve({ ok: code === 0, code, stdout, stderr, missing: false })
    }
    child.on('error', (e) => {
      if (timer) clearTimeout(timer)
      resolve({ ok: false, code: 1, stdout, stderr: stderr + String(e), missing: false })
    })
    child.on('close', done)
  })
}
