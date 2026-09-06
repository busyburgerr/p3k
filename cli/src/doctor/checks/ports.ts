import type { Check, Finding } from '../../types.js'
import { listeners, isWildcard, type Listener } from '../../util/net.js'

function describe(l: Listener): string {
  const who = l.process ? `${l.process}${l.pid ? ` (PID ${l.pid})` : ''}` : l.pid ? `PID ${l.pid}` : 'владелец неизвестен'
  const where = isWildcard(l.address) ? `${l.address} (все интерфейсы)` : l.address
  return `${where} — ${who}`
}

function killHint(pid: number): string {
  return process.platform === 'win32' ? `taskkill /PID ${pid} /F` : `kill ${pid}`
}

export const portsCheck: Check = {
  id: 'ports',
  group: 'ПОРТЫ',
  async run(ctx): Promise<Finding[]> {
    const out: Finding[] = []

    for (const { port, source } of ctx.ports) {
      const found = await listeners(port)

      if (found.length === 0) {
        out.push({ level: 'ok', title: `${port} свободен`, detail: `источник номера: ${source}` })
        continue
      }

      const pid = found.find((l) => l.pid !== undefined)?.pid
      out.push({
        level: 'warn',
        title: `${port} занят`,
        detail: [`источник номера: ${source}`, ...found.map(describe)].join('\n'),
        fix: [
          'если это ваш же dev-сервер — всё в порядке, проверка не различает свой и чужой процесс',
          ...(pid === undefined ? [] : [killHint(pid)]),
        ],
      })
    }

    return out
  },
}
