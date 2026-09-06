const useColor = process.stdout.isTTY && !process.env.NO_COLOR

/** Палитра для префиксов. Цвета повторяются, если процессов больше, чем цветов. */
const PALETTE = ['36', '35', '32', '33', '34', '91', '92', '95']

const paint = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)
const dim = (s: string) => paint('2', s)

/**
 * Один поток вывода на все процессы.
 *
 * Каждая строка получает префикс с именем процесса, выровненный по самому
 * длинному имени. Куски, пришедшие без перевода строки, копятся в буфере и
 * печатаются целой строкой — иначе вывод параллельных процессов перемешивается
 * посреди слова.
 */
export class LogMux {
  private readonly width: number
  private readonly colors = new Map<string, string>()
  private readonly buffers = new Map<string, string>()

  constructor(names: string[]) {
    this.width = names.reduce((max, n) => Math.max(max, n.length), 6)
    names.forEach((n, i) => this.colors.set(n, PALETTE[i % PALETTE.length] as string))
  }

  private prefix(name: string): string {
    return paint(this.colors.get(name) ?? '37', name.padEnd(this.width)) + dim(' │ ')
  }

  /** Служебное сообщение самого dev — визуально отделено от вывода процессов. */
  system(text: string, tone: 'info' | 'warn' | 'fail' = 'info') {
    const code = tone === 'fail' ? '31' : tone === 'warn' ? '33' : '2'
    process.stdout.write(`${''.padEnd(this.width)}${dim(' │ ')}${paint(code, text)}\n`)
  }

  /** Заголовок без префикса — для рамок вокруг запуска и остановки. */
  banner(text: string) {
    process.stdout.write(`${text}\n`)
  }

  /** Кусок вывода процесса. Печатаются только законченные строки. */
  chunk(name: string, data: string) {
    const merged = (this.buffers.get(name) ?? '') + data
    const parts = merged.split(/\r?\n/)
    const tail = parts.pop() ?? ''
    this.buffers.set(name, tail)
    for (const line of parts) process.stdout.write(this.prefix(name) + line + '\n')
  }

  /** Дописать всё, что осталось в буферах, когда процессы закончились. */
  flush() {
    for (const [name, tail] of this.buffers) {
      if (tail.trim() !== '') process.stdout.write(this.prefix(name) + tail + '\n')
    }
    this.buffers.clear()
  }
}
