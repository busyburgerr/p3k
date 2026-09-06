import { connect } from 'node:net'
import { lookup } from 'node:dns/promises'
import { exec } from './exec.js'

export interface Listener {
  /** Адрес, на котором открыт слушающий сокет, как его сообщила система. */
  address: string
  family: 4 | 6
  pid?: number
  process?: string
}

/**
 * 'refused' — порт точно закрыт: пришёл честный отказ.
 * 'blocked' и 'error' — выяснить не удалось: локальная политика, фаервол,
 * песочница. Это не то же самое, что «закрыт», и выводы отсюда делать нельзя.
 */
export type ProbeResult = 'open' | 'refused' | 'timeout' | 'blocked' | 'error'

export const inconclusive = (r: ProbeResult) => r === 'blocked' || r === 'error'

/** Пробуем установить TCP-соединение — единственный честный способ узнать, отвечает ли адрес. */
export function probe(host: string, port: number, timeout = 1500): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let done = false
    const finish = (r: ProbeResult) => {
      if (done) return
      done = true
      socket.destroy()
      resolve(r)
    }
    const socket = connect({ host, port })
    socket.setTimeout(timeout)
    socket.once('connect', () => finish('open'))
    socket.once('timeout', () => finish('timeout'))
    socket.once('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ECONNREFUSED') return finish('refused')
      if (e.code === 'EACCES' || e.code === 'EPERM') return finish('blocked')
      finish('error')
    })
  })
}

/** В какие адреса резолвится имя. Пустой массив — не резолвится вовсе. */
export async function resolveAll(host: string): Promise<string[]> {
  try {
    const found = await lookup(host, { all: true, verbatim: true })
    return found.map((a) => a.address)
  } catch {
    return []
  }
}

function splitHostPort(raw: string): { host: string; port: number } | null {
  const bracket = /^\[(.+)\]:(\d+)$/.exec(raw)
  if (bracket?.[1] && bracket[2]) return { host: bracket[1], port: Number(bracket[2]) }
  const idx = raw.lastIndexOf(':')
  if (idx < 0) return null
  const host = raw.slice(0, idx)
  const port = Number(raw.slice(idx + 1))
  if (!Number.isInteger(port)) return null
  return { host, port }
}

async function windowsListeners(port: number): Promise<Listener[]> {
  // Без -p: на Windows фильтр '-p TCP' отбрасывает IPv6-сокеты, а они здесь
  // и есть самое интересное. В общем выводе они идут с тем же ярлыком TCP.
  const res = await exec('netstat', ['-ano'], 8000)
  if (!res.ok) return []
  const out: Listener[] = []
  for (const line of res.stdout.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 5 || cols[0] !== 'TCP') continue
    if ((cols[3] ?? '').toUpperCase() !== 'LISTENING') continue
    const local = splitHostPort(cols[1] ?? '')
    if (!local || local.port !== port) continue
    const pid = Number(cols[4])
    out.push({
      address: local.host,
      family: local.host.includes(':') ? 6 : 4,
      pid: Number.isInteger(pid) ? pid : undefined,
    })
  }
  await Promise.all(
    out.map(async (l) => {
      if (l.pid === undefined) return
      const t = await exec('tasklist', ['/FI', `PID eq ${l.pid}`, '/FO', 'CSV', '/NH'])
      const name = /^"([^"]+)"/.exec(t.stdout.trim())?.[1]
      if (name && name !== 'INFO:') l.process = name
    }),
  )
  return out
}

async function unixListeners(port: number): Promise<Listener[]> {
  const ls = await exec('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], 8000)
  if (ls.ok && ls.stdout.trim()) {
    const out: Listener[] = []
    for (const line of ls.stdout.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/)
      const name = cols[cols.length - 1] ?? ''
      const local = splitHostPort(name)
      if (!local || local.port !== port) continue
      const pid = Number(cols[1])
      out.push({
        address: local.host,
        family: local.host.includes(':') ? 6 : 4,
        pid: Number.isInteger(pid) ? pid : undefined,
        process: cols[0],
      })
    }
    if (out.length) return out
  }

  const ss = await exec('ss', ['-lptnH'], 8000)
  if (!ss.ok) return []
  const out: Listener[] = []
  for (const line of ss.stdout.split('\n')) {
    const cols = line.trim().split(/\s+/)
    const local = splitHostPort(cols[3] ?? '')
    if (!local || local.port !== port) continue
    const owner = /\(\("([^"]+)",pid=(\d+)/.exec(line)
    out.push({
      address: local.host,
      family: local.host.includes(':') ? 6 : 4,
      pid: owner?.[2] ? Number(owner[2]) : undefined,
      process: owner?.[1],
    })
  }
  return out
}

/** Кто слушает порт. Пустой массив означает «никто», а не «не смогли узнать». */
export async function listeners(port: number): Promise<Listener[]> {
  return process.platform === 'win32' ? windowsListeners(port) : unixListeners(port)
}

/** Слушает ли сокет все интерфейсы сразу. */
export const isWildcard = (address: string) => address === '0.0.0.0' || address === '::' || address === '*'
