export interface Template {
  id: string
  title: string
  /** Одна строка для списка: что получится и что для этого нужно. */
  summary: string
  requires?: string
  /** Путь → содержимое. Подстановка {{name}} происходит и в путях, и в содержимом. */
  files: Record<string, string>
  /** Что сказать человеку после создания. */
  next: string[]
}

const GITIGNORE = `node_modules
dist
.env
*.local
`

// ─── статический сайт: сборка и сервер, без Docker ───────────────────────────

const STATIC_SERVER = `import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const PORT = Number(process.env.PORT ?? 4000)
const ROOT = 'dist'
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
}

createServer(async (req, res) => {
  // Разбираем URL по сегментам, а не через path.normalize: на Windows
  // normalize('/') даёт разделитель каталогов и склейка ломается. Заодно
  // выбрасываем '..' целиком — так /../.env не выйдет за каталог с сайтом.
  const url = decodeURIComponent((req.url ?? '/').split('?')[0])
  const segments = url.split('/').filter((s) => s !== '' && s !== '.' && s !== '..')
  if (segments.length === 0 || url.endsWith('/')) segments.push('index.html')
  const path = join(ROOT, ...segments)

  try {
    const body = await readFile(path)
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('не найдено')
  }
}).listen(PORT, () => console.log(\`сервер на http://localhost:\${PORT}\`))
`

const STATIC_BUILD = `import { cp, mkdir, rm } from 'node:fs/promises'

// Заготовка сборки: копирует public/ в dist/.
// Замените на свой сборщик — dev выполнит этот шаг до запуска сервера
// и не пойдёт дальше, пока он не завершится успешно.
await rm('dist', { recursive: true, force: true })
await mkdir('dist', { recursive: true })
await cp('public', 'dist', { recursive: true })
console.log('собрано: public → dist')
`

const STATIC_INDEX = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{{name}}</title>
    <style>
      body { margin: 0; display: grid; place-items: center; min-height: 100vh;
             font-family: ui-monospace, monospace; background: #0b0b0b; color: #f3f3f1; }
      code { color: #e0574a; }
    </style>
  </head>
  <body>
    <main>
      <h1>{{name}}</h1>
      <p>Правьте <code>public/index.html</code> и перезапустите <code>p3k dev</code>.</p>
    </main>
  </body>
</html>
`

const STATIC_CONFIG = `{
  "processes": {
    "build": {
      "command": "node build.mjs",
      "oneShot": true
    },
    "web": {
      "command": "node server.mjs",
      "needs": ["build"],
      "ready": { "port": 4000 }
    }
  },
  "checks": {
    "build":  { "command": "node build.mjs" },
    "bundle": { "size": { "path": "dist", "max": "200kb", "gzip": true }, "needs": ["build"] }
  }
}
`

// ─── API с Postgres в контейнере ─────────────────────────────────────────────

const API_SERVER = `import { createServer } from 'node:http'
import { connect } from 'node:net'

const PORT = Number(process.env.PORT ?? 4000)
const DB_PORT = Number(process.env.DB_PORT ?? 5432)

/** Проверка доступности базы без драйвера: соединение либо устанавливается, либо нет. */
const dbReachable = () =>
  new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: DB_PORT })
    const done = (value) => { socket.destroy(); resolve(value) }
    socket.setTimeout(500)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })

createServer(async (_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ service: '{{name}}', db: (await dbReachable()) ? 'доступна' : 'недоступна' }))
}).listen(PORT, () => console.log(\`API на http://localhost:\${PORT}\`))
`

const API_MIGRATE = `// Заготовка миграций.
//
// В p3k.json этот шаг помечен "oneShot": true — он должен отработать
// и завершиться. Пока он не выйдет с нулём, API не стартует.
console.log('миграции: применять нечего')
`

const API_CONFIG = `{
  "processes": {
    "db": {
      "command": "docker run --rm --name {{name}}-db -p 5432:5432 -e POSTGRES_PASSWORD=dev -e POSTGRES_DB={{name}} postgres:16",
      "//": "port сработал бы раньше времени: Postgres принимает соединения ещё во время инициализации",
      "ready": { "exec": "docker exec {{name}}-db pg_isready -U postgres" },
      "stop": "docker stop {{name}}-db"
    },
    "migrate": {
      "command": "node migrate.mjs",
      "needs": ["db"],
      "oneShot": true
    },
    "api": {
      "command": "node src/server.mjs",
      "needs": ["migrate"],
      "ready": { "http": "http://127.0.0.1:4000/" }
    }
  },
  "checks": {
    "syntax": { "command": "node --check src/server.mjs" }
  }
}
`

const pkg = (scripts: string) => `{
  "name": "{{name}}",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": {
${scripts}
  }
}
`

export const TEMPLATES: Template[] = [
  {
    id: 'static',
    title: 'Статический сайт',
    summary: 'сборка и сервер статики — два процесса, показывает одноразовый шаг',
    files: {
      'package.json': pkg('    "build": "node build.mjs",\n    "start": "node server.mjs"'),
      'build.mjs': STATIC_BUILD,
      'server.mjs': STATIC_SERVER,
      'public/index.html': STATIC_INDEX,
      'p3k.json': STATIC_CONFIG,
      '.env.example': 'PORT=4000\n',
      '.gitignore': GITIGNORE,
    },
    next: ['p3k dev', 'откройте http://localhost:4000'],
  },
  {
    id: 'node-postgres',
    title: 'API с Postgres',
    summary: 'база в контейнере, миграции, API — весь граф зависимостей целиком',
    requires: 'Docker',
    files: {
      'package.json': pkg('    "migrate": "node migrate.mjs",\n    "start": "node src/server.mjs"'),
      'src/server.mjs': API_SERVER,
      'migrate.mjs': API_MIGRATE,
      'p3k.json': API_CONFIG,
      '.env.example': 'PORT=4000\nDB_PORT=5432\nDATABASE_URL=postgres://postgres:dev@localhost:5432/{{name}}\n',
      '.gitignore': GITIGNORE,
    },
    next: ['cp .env.example .env', 'p3k dev', 'curl http://localhost:4000'],
  },
]

export const findTemplate = (id: string) => TEMPLATES.find((t) => t.id === id) ?? null

/** Имя проекта попадает в package.json и в имя контейнера — оставляем только безопасное. */
export function slugify(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 40)
  return slug === '' ? 'app' : slug
}
