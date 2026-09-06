import type { Check, Finding } from '../../types.js'
import { listeners, probe, resolveAll, inconclusive, type Listener, type ProbeResult } from '../../util/net.js'

const V4 = '127.0.0.1'
const V6 = '::1'

/**
 * Сервер поднялся, порт занят, в логе написано «ready» — а в браузере пусто.
 *
 * Так бывает, когда слушающий сокет открыт только в одном семействе адресов.
 * Клиенты расходятся в том, какой адрес выбрать для `localhost`: Node идёт по
 * системному резолверу, браузеры имеют собственные правила и часто
 * предпочитают IPv4. Сокет, доступный только по одному семейству, работает у
 * одного инструмента и молча отказывает другому.
 *
 * Основное свидетельство — таблица слушающих сокетов: `::1` физически не
 * принимает IPv4, и это видно без единого соединения. Пробы нужны лишь там,
 * где адрес неоднозначен (`::` в dual-stack принимает и IPv4), и служат
 * подтверждением, а не источником вывода: заблокированная фаерволом проба
 * означает «не выяснили», а не «закрыто».
 */

interface Coverage {
  /** IPv4 обслуживается наверняка. */
  v4: boolean
  /** IPv6 обслуживается наверняка. */
  v6: boolean
  /**
   * Есть сокет на `::`, и при этом ни одного явного IPv4.
   *
   * Такой сокет может быть как dual-stack (Linux по умолчанию принимает и
   * IPv4-mapped адреса), так и чисто IPv6 (ipv6Only). По таблице это не
   * различить, поэтому здесь и только здесь нужна проба соединением.
   * На Windows dual-stack виден двумя строками сразу, и до сюда не доходит.
   */
  ambiguous: boolean
}

function coverage(found: Listener[]): Coverage {
  const addrs = new Set(found.map((l) => l.address))
  const anyV4 = addrs.has(V4) || addrs.has('0.0.0.0') || addrs.has('*')
  const v6Wildcard = addrs.has('::') || addrs.has('*')
  return {
    v4: anyV4,
    // `::1` не принимает IPv4 никогда — это надёжный признак, в отличие от `::`.
    v6: addrs.has(V6) || v6Wildcard,
    ambiguous: v6Wildcard && !anyV4,
  }
}

const probeLine = (host: string, port: number, r: ProbeResult) =>
  `${host.includes(':') ? `[${host}]` : host}:${port} — ${
    { open: 'соединение установлено', refused: 'отказано в соединении', timeout: 'таймаут', blocked: 'заблокировано локально', error: 'ошибка' }[r]
  }`

export const loopbackCheck: Check = {
  id: 'network/loopback',
  group: 'СЕТЬ',
  async run(ctx): Promise<Finding[]> {
    const out: Finding[] = []
    const localhost = await resolveAll('localhost')

    if (localhost.length === 0) {
      out.push({
        level: 'fail',
        title: 'localhost не резолвится',
        detail: 'системный резолвер не вернул ни одного адреса для localhost',
        fix: 'проверьте файл hosts: должны быть строки "127.0.0.1 localhost" и "::1 localhost"',
      })
    }

    let examined = 0

    for (const { port } of ctx.ports) {
      const found = await listeners(port)
      if (found.length === 0) continue
      examined++

      const cov = coverage(found)
      const bound = found.map((l) => l.address).join(', ')
      const resolvesTo = localhost.length ? `localhost резолвится в ${localhost.join(', ')}` : 'localhost не резолвится'

      if (cov.v4 && cov.v6) {
        out.push({ level: 'ok', title: `${port} доступен и по IPv4, и по IPv6`, detail: `привязка: ${bound}` })
        continue
      }

      if (cov.v6 && !cov.v4 && !cov.ambiguous) {
        out.push({
          level: 'fail',
          title: `${port} слушается только по IPv6`,
          detail: [
            `привязка: ${bound} — этот адрес не принимает IPv4-соединения`,
            resolvesTo,
            'браузеры и curl, выбирающие IPv4, получат отказ: страница будет пустой, а в логе сервера не появится ни одной ошибки',
          ].join('\n'),
          fix: ["привяжите сервер к IPv4: server.host = '127.0.0.1' в конфиге", 'или слушайте оба семейства сразу'],
        })
        continue
      }

      if (cov.v4 && !cov.v6) {
        out.push({
          level: 'warn',
          title: `${port} слушается только по IPv4`,
          detail: [
            `привязка: ${bound}`,
            resolvesTo,
            'клиент, предпочитающий IPv6, получит отказ; большинство откатывается на IPv4, поэтому это предупреждение, а не ошибка',
          ].join('\n'),
        })
        continue
      }

      // Либо `::` без явного IPv4, либо нестандартный адрес: таблица ничего
      // не доказывает — идём проверять соединением.
      const [v4, v6] = await Promise.all([probe(V4, port), probe(V6, port)])
      if (inconclusive(v4) && inconclusive(v6)) {
        out.push({
          level: 'skip',
          title: `${port}: достижимость выяснить не удалось`,
          detail: [`привязка: ${bound}`, probeLine(V4, port, v4), probeLine(V6, port, v6)].join('\n'),
        })
        continue
      }
      out.push({
        level: v4 === 'open' || v6 === 'open' ? 'ok' : 'warn',
        title:
          v4 === 'open' || v6 === 'open'
            ? `${port} отвечает на loopback`
            : `${port} занят, но на loopback не отвечает`,
        detail: [`привязка: ${bound}`, probeLine(V4, port, v4), probeLine(V6, port, v6)].join('\n'),
      })
    }

    if (examined === 0 && localhost.length > 0) {
      out.push({
        level: 'skip',
        title: 'достижимость портов',
        detail: 'ни один из портов проекта сейчас не слушается — запустите dev-сервер и повторите',
      })
    }

    return out
  },
}
