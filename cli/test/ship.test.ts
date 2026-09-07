import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigError } from '../src/config.js'
import { parseDeploy, releaseId, uniqueRelease, RELEASE_ID } from '../src/ship/config.js'
import { runShip } from '../src/ship/index.js'

const base = { path: '/srv/app', upload: ['dist'] }

test('минимальная секция выкатки разбирается с разумными умолчаниями', () => {
  const d = parseDeploy(base, 'deploy')
  assert.equal(d.host, null)
  assert.equal(d.keep, 5)
  assert.equal(d.checks, true)
  assert.equal(d.health, null)
})

test('здоровье задаётся строкой или объектом', () => {
  assert.deepEqual(parseDeploy({ ...base, health: 'https://x/health' }, 'deploy').health, {
    url: 'https://x/health',
    timeout: 60,
  })
  assert.deepEqual(parseDeploy({ ...base, health: { url: 'http://x', status: 204, timeout: 5 } }, 'deploy').health, {
    url: 'http://x',
    status: 204,
    timeout: 5,
  })
})

test('без path и без upload выкатка не описана', () => {
  assert.throws(() => parseDeploy({ upload: ['dist'] }, 'deploy'), ConfigError)
  assert.throws(() => parseDeploy({ path: '/srv/app' }, 'deploy'), ConfigError)
  assert.throws(() => parseDeploy({ ...base, upload: [] }, 'deploy'), ConfigError)
})

test('пути отправки не выпускаются за пределы проекта', () => {
  for (const bad of ['/etc/passwd', '../секреты', 'C:\\Windows', 'dist/../../..']) {
    assert.throws(
      () => parseDeploy({ ...base, upload: [bad] }, 'deploy'),
      ConfigError,
      `путь "${bad}" должен быть отвергнут`,
    )
  }
})

test('keep меньше двух отвергается — откатываться было бы некуда', () => {
  assert.throws(() => parseDeploy({ ...base, keep: 1 }, 'deploy'), ConfigError)
  assert.equal(parseDeploy({ ...base, keep: 2 }, 'deploy').keep, 2)
})

test('имя выпуска сортируется по алфавиту так же, как по времени', () => {
  const earlier = releaseId(new Date('2026-09-07T17:22:56Z'))
  const later = releaseId(new Date('2026-09-07T17:22:57Z'))
  assert.equal(earlier, '20260907-172256')
  assert.ok(earlier < later)
  assert.match(earlier, RELEASE_ID)
})

test('две выкатки в одну секунду получают разные имена', () => {
  const first = uniqueRelease([], '20260907-172256')
  const second = uniqueRelease([first], '20260907-172256')
  const third = uniqueRelease([first, second], '20260907-172256')

  assert.notEqual(first, second)
  assert.ok(first < second && second < third, 'порядок имён должен сохраняться')
  for (const id of [first, second, third]) assert.match(id, RELEASE_ID)
})

/**
 * Полный цикл выкатки на локальной цели.
 *
 * Проверяется главное обещание команды: испорченный выпуск не остаётся
 * работать. Приложение здесь — файл version.txt, который читает поднятый в
 * тесте сервер; он отвечает 500, если содержимое не то. Так проверка здоровья
 * настоящая, а не имитация.
 */
test('негодный выпуск откатывается, и продолжает работать прежний', async () => {
  const project = mkdtempSync(join(tmpdir(), 'p3k-ship-src-'))
  const server = mkdtempSync(join(tmpdir(), 'p3k-ship-dst-'))
  mkdirSync(join(project, 'app'))
  writeFileSync(join(project, 'package.json'), '{"name":"ship-demo","private":true}')

  const http = createServer((_req, res) => {
    let body = ''
    try {
      body = readFileSync(join(server, 'current', 'app', 'version.txt'), 'utf8').trim()
    } catch {
      body = 'нет файла'
    }
    res.writeHead(body === 'годная' ? 200 : 500).end(body)
  })
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r))
  const port = (http.address() as { port: number }).port

  writeFileSync(
    join(project, 'p3k.json'),
    JSON.stringify({
      processes: { app: { command: 'node app.mjs' } },
      deploy: {
        path: server,
        upload: ['app'],
        checks: false,
        health: { url: `http://127.0.0.1:${port}/`, timeout: 4 },
      },
    }),
  )

  // Вывод команды забираем себе: в отчёте теста он лишний, а проверять по нему
  // всё равно нужно.
  const cwd = process.cwd()
  let log = ''
  const io = { out: (s: string) => (log += s), err: (s: string) => (log += s) }
  process.chdir(project)

  try {
    writeFileSync(join(project, 'app', 'version.txt'), 'годная')
    assert.equal(await runShip([], io), 0, 'здоровый выпуск должен выкатиться')
    assert.equal(readFileSync(join(server, 'current', 'app', 'version.txt'), 'utf8'), 'годная')

    const first = readFileSync(join(server, 'current', 'app', 'version.txt'), 'utf8')
    assert.equal(first, 'годная')

    writeFileSync(join(project, 'app', 'version.txt'), 'сломанная')
    assert.equal(await runShip([], io), 1, 'нездоровый выпуск должен провалиться')

    // Главное: цель вернулась к прежнему выпуску, а не осталась сломанной.
    assert.equal(
      readFileSync(join(server, 'current', 'app', 'version.txt'), 'utf8'),
      'годная',
      'после отката должен работать прежний выпуск',
    )
    assert.match(log, /откат на \d{8}-\d{6}/)

    const res = await fetch(`http://127.0.0.1:${port}/`)
    assert.equal(res.status, 200, 'сервер снова отвечает')

    // Оба выпуска остаются на цели: сломанный нужен, чтобы посмотреть логи.
    log = ''
    assert.equal(await runShip(['--releases'], io), 0)
    assert.equal((log.match(/\d{8}-\d{6}/g) ?? []).length, 2)
  } finally {
    process.chdir(cwd)
    http.close()
  }
})

test('без секции deploy команда объясняет, чего не хватает', async () => {
  const project = mkdtempSync(join(tmpdir(), 'p3k-ship-none-'))
  writeFileSync(join(project, 'package.json'), '{"name":"нет-выкатки","private":true}')
  writeFileSync(join(project, 'p3k.json'), '{"processes":{"app":{"command":"node ."}}}')

  const cwd = process.cwd()
  let log = ''
  process.chdir(project)

  try {
    assert.equal(await runShip([], { out: () => {}, err: (s) => (log += s) }), 2)
    assert.match(log, /нет секции deploy/)
  } finally {
    process.chdir(cwd)
  }
})
