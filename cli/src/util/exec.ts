import { execFile } from 'node:child_process'

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
