import type { DocBlock } from './data.docs'

/**
 * Готовые конфиги под настоящие стеки.
 *
 * Каждый конфиг проверяется скриптом scripts/check-recipes.mjs настоящим
 * разбором из CLI: JSON валиден, зависимости сходятся в граф, условия
 * готовности допустимы. Чего проверка не покажет — что образ действительно
 * поднимется, — отмечено в тексте рецепта.
 */

export interface Recipe {
  id: string
  nav: string
  title: string
  kicker: string
  summary: string
  requires?: string
  config: string[]
  blocks: DocBlock[]
}

export const recipes: Recipe[] = [
  {
    id: 'r-api-pg',
    nav: 'API + Postgres',
    title: 'Бэкенд с базой в контейнере',
    kicker: 'САМЫЙ ЧАСТЫЙ СЛУЧАЙ',
    summary: 'база, миграции, приложение — по порядку и с настоящей проверкой готовности',
    requires: 'Docker',
    config: [
      '{',
      '  "processes": {',
      '    "db": {',
      '      "command": "docker run --rm --name app-db -p 5432:5432 -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=app postgres:16",',
      '      "ready": { "exec": "docker exec app-db pg_isready -U postgres" },',
      '      "stop": "docker stop app-db"',
      '    },',
      '    "migrate": {',
      '      "command": "npm run migrate",',
      '      "needs": ["db"],',
      '      "oneShot": true',
      '    },',
      '    "api": {',
      '      "command": "npm run dev",',
      '      "needs": ["migrate"],',
      '      "env": { "DATABASE_URL": "postgres://postgres:dev@localhost:5432/app" },',
      '      "ready": { "http": "http://localhost:4000/health" }',
      '    }',
      '  }',
      '}',
    ],
    blocks: [
      {
        kind: 'text',
        text: 'Ключевая строка здесь — условие готовности базы. Postgres открывает порт 5432 ещё во время инициализации кластера, поэтому { "port": 5432 } сработает слишком рано: миграции стартуют и получат отказ от самой базы. pg_isready спрашивает саму службу и отвечает только когда она готова принимать запросы.',
      },
      {
        kind: 'text',
        text: 'stop нужен, потому что контейнер переживает процесс, который его запустил. Без этой строки после Ctrl+C контейнер остался бы работать и держать порт — при следующем запуске dev отказался бы стартовать с сообщением «порт 5432 занят».',
      },
      {
        kind: 'note',
        text: 'Пароль в примере — dev, и он в открытом виде: так и должно быть для локального контейнера, который живёт полчаса. Не переносите эту строку в продакшен.',
      },
    ],
  },

  {
    id: 'r-compose',
    nav: 'docker compose',
    title: 'Когда compose уже есть',
    kicker: 'НЕ ПЕРЕПИСЫВАТЬ',
    summary: 'существующий compose поднимается как есть, приложение живёт рядом процессом',
    requires: 'Docker',
    config: [
      '{',
      '  "processes": {',
      '    "services": {',
      '      "command": "docker compose up -d --wait",',
      '      "oneShot": true,',
      '      "stop": "docker compose down"',
      '    },',
      '    "api": {',
      '      "command": "npm run dev",',
      '      "needs": ["services"],',
      '      "ready": { "http": "http://localhost:4000/health" }',
      '    },',
      '    "web": {',
      '      "command": "npm run dev --workspace web",',
      '      "needs": ["api"],',
      '      "ready": { "log": "ready in" }',
      '    }',
      '  }',
      '}',
    ],
    blocks: [
      {
        kind: 'text',
        text: 'Свой docker-compose.yml переписывать не нужно. Флаг --wait заставляет compose дождаться healthcheck всех служб и только потом выйти, поэтому шаг помечен oneShot: он отрабатывает и завершается, а контейнеры остаются жить.',
      },
      {
        kind: 'text',
        text: 'Команда остановки выполняется и для уже завершившихся шагов — именно ради таких случаев. Контейнеры, поднятые через up -d, переживают процесс, который их создал, и убрать их может только docker compose down.',
      },
      {
        kind: 'note',
        text: 'Если в compose-файле нет healthcheck, --wait ждать нечего и он вернётся сразу. Тогда добавьте условие готовности зависимым процессам — { exec } или { http }, — иначе они стартуют раньше, чем службы поднимутся.',
      },
    ],
  },

  {
    id: 'r-full',
    nav: 'Полный стек',
    title: 'База, кэш, API, воркер и фронтенд',
    kicker: 'ПЯТЬ ПРОЦЕССОВ, ТРИ ВОЛНЫ',
    summary: 'независимое идёт параллельно, зависимое ждёт — порядок задаёт только needs',
    requires: 'Docker',
    config: [
      '{',
      '  "processes": {',
      '    "db": {',
      '      "command": "docker run --rm --name app-db -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:16",',
      '      "ready": { "exec": "docker exec app-db pg_isready -U postgres" },',
      '      "stop": "docker stop app-db"',
      '    },',
      '    "cache": {',
      '      "command": "docker run --rm --name app-cache -p 6379:6379 redis:7",',
      '      "ready": { "exec": "docker exec app-cache redis-cli ping" },',
      '      "stop": "docker stop app-cache"',
      '    },',
      '    "api": {',
      '      "command": "npm run dev --workspace api",',
      '      "needs": ["db", "cache"],',
      '      "ready": { "http": "http://localhost:4000/health" }',
      '    },',
      '    "worker": {',
      '      "command": "npm run dev --workspace worker",',
      '      "needs": ["db", "cache"],',
      '      "ready": { "log": "worker готов" }',
      '    },',
      '    "web": {',
      '      "command": "npm run dev --workspace web",',
      '      "needs": ["api"],',
      '      "ready": { "log": "ready in" }',
      '    }',
      '  }',
      '}',
    ],
    blocks: [
      {
        kind: 'text',
        text: 'Волн получается три. Первая — db и cache: они ни от чего не зависят и поднимаются одновременно. Вторая — api и worker: оба ждут обе службы, но друг друга не ждут и тоже идут параллельно. Третья — web. Порядок нигде не записан явно: он выводится из needs.',
      },
      {
        kind: 'code',
        caption: 'ЧТО УВИДИТЕ',
        lines: [
          '       │ процессов: 5, волн запуска: 3',
          '       │ db: готов (успех "docker exec app-db pg_isready -U postgres")',
          '       │ cache: готов (успех "docker exec app-cache redis-cli ping")',
          'api    │ listening on 4000',
          '       │ api: готов (ответ http://localhost:4000/health)',
          'worker │ worker готов',
          'web    │ ready in 312 ms',
          '       │ всё поднято — Ctrl+C для остановки',
        ],
      },
      {
        kind: 'text',
        text: 'Ctrl+C гасит всё в обратном порядке: сначала web, потом api и worker, потом db и cache — и для контейнеров выполняются их команды остановки. Ни один порт не останется занятым.',
      },
    ],
  },

  {
    id: 'r-python',
    nav: 'Python',
    title: 'FastAPI или Django с Postgres',
    kicker: 'НЕ ТОЛЬКО NODE',
    summary: 'в command может быть что угодно — инструменту всё равно, на чём написан проект',
    requires: 'Docker',
    config: [
      '{',
      '  "processes": {',
      '    "db": {',
      '      "command": "docker run --rm --name app-db -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:16",',
      '      "ready": { "exec": "docker exec app-db pg_isready -U postgres" },',
      '      "stop": "docker stop app-db"',
      '    },',
      '    "migrate": {',
      '      "command": "python manage.py migrate",',
      '      "needs": ["db"],',
      '      "oneShot": true',
      '    },',
      '    "api": {',
      '      "command": "uvicorn app.main:app --reload --port 8000",',
      '      "needs": ["migrate"],',
      '      "ready": { "http": "http://localhost:8000/health" }',
      '    }',
      '  }',
      '}',
    ],
    blocks: [
      {
        kind: 'text',
        text: 'Инструмент написан на Node, но запускает что угодно: команда идёт через оболочку. Python, Go, Rust, make — разницы нет. Единственное требование к проекту — наличие Node 18 для самого p3k.',
      },
      {
        kind: 'note',
        text: 'Виртуальное окружение активируйте внутри команды или задайте путь к интерпретатору напрямую: "command": ".venv/bin/uvicorn app.main:app". Своей магии с окружениями инструмент не делает.',
      },
    ],
  },

  {
    id: 'r-vps',
    nav: 'VPS целиком',
    title: 'Бэкенд на своём сервере',
    kicker: 'ОТ ЛОКАЛКИ ДО ПРОДА',
    summary: 'один файл описывает и ноутбук, и сервер: база, выпуски, здоровье, откат',
    requires: 'Docker и SSH-ключ на сервере',
    config: [
      '{',
      '  "processes": {',
      '    "postgres": {',
      '      "command": "docker run --rm --name shop-postgres -p 5432:5432 -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=shop -v shop-postgres-data:/var/lib/postgresql/data postgres:16",',
      '      "ready": { "exec": "docker exec shop-postgres pg_isready -U postgres" },',
      '      "stop": "docker stop shop-postgres"',
      '    },',
      '    "api": {',
      '      "command": "node src/server.mjs",',
      '      "needs": ["postgres"],',
      '      "env": { "DATABASE_URL": "postgres://postgres:dev@localhost:5432/shop" },',
      '      "ready": { "http": "http://localhost:4000/health" }',
      '    }',
      '  },',
      '  "resources": {',
      '    "postgres": { "type": "postgres", "ports": { "port": 5432 } }',
      '  },',
      '  "checks": {',
      '    "test": { "command": "npm test", "inputs": ["src", "test"] }',
      '  },',
      '  "deploy": {',
      '    "host": "root@203.0.113.10",',
      '    "path": "/srv/shop",',
      '    "build": "npm run build",',
      '    "upload": ["dist", "package.json", "package-lock.json"],',
      '    "release": "npm ci --omit=dev && node dist/migrate.js",',
      '    "restart": "systemctl restart shop",',
      '    "health": "https://ваш-домен/health",',
      '    "keep": 5',
      '  }',
      '}',
    ],
    blocks: [
      {
        kind: 'text',
        text: 'Секции processes и resources писать руками не нужно — их создаёт p3k add postgres. Первая говорит, как база поднимается на ноутбуке; вторая помнит, что это именно PostgreSQL, и по ней ship соберёт для сервера compose-файл. Описание одно, окружения два.',
      },
      {
        kind: 'code',
        caption: 'ТЕРМИНАЛ',
        lines: [
          'p3k add postgres      описать базу — сразу для локалки и для сервера',
          'p3k dev               поднять всё локально',
          'p3k ship --dry-run    план выкатки и проверка связи с сервером',
          'p3k ship              выкатить',
        ],
      },
      {
        kind: 'text',
        text: 'Команда release выполняется в новом выпуске до того, как на него переключатся. Поэтому упавшая миграция не сломает работающий сайт: ссылка current всё ещё указывает на прежний выпуск, а негодный остаётся на месте — с ним можно разбираться не торопясь.',
      },
      {
        kind: 'note',
        text: 'Адрес в health опрашивается с той машины, откуда идёт выкатка, а не с сервера. Поэтому здесь публичный адрес, а не localhost: до 127.0.0.1 сервера с ноутбука не достучаться.',
      },
      {
        kind: 'note',
        text: 'Пароль базы на сервере берётся из /srv/shop/shared/.env — его вы заполняете один раз сами. В p3k.json продакшен-секретов нет вообще, и первая выкатка честно откажется идти дальше, пока этого файла нет.',
      },
    ],
  },

  {
    id: 'r-checks',
    nav: 'Проверки',
    title: 'Проверки для бэкенда',
    kicker: 'ДО ПУША',
    summary: 'тесты против настоящей базы, а не против моков',
    requires: 'Docker',
    config: [
      '{',
      '  "checks": {',
      '    "lint":  { "command": "ruff check .", "inputs": ["app"] },',
      '    "types": { "command": "mypy app", "inputs": ["app"] },',
      '    "db-up": {',
      '      "command": "docker compose -f compose.test.yml up -d --wait",',
      '      "inputs": ["compose.test.yml"]',
      '    },',
      '    "tests": {',
      '      "command": "pytest",',
      '      "needs": ["db-up"],',
      '      "inputs": ["app", "tests"]',
      '    }',
      '  }',
      '}',
    ],
    blocks: [
      {
        kind: 'text',
        text: 'lint и types ни от чего не зависят и идут параллельно. Тесты ждут поднятой базы, поэтому у них needs. Если база не поднялась, тесты не запускаются и помечаются пропущенными, а не проваленными: провал означал бы, что код плохой, а он просто не проверялся.',
      },
      {
        kind: 'text',
        text: 'Поле inputs включает кэш по содержимому файлов. Правите только тесты — линтер и типы во второй раз не запускаются вовсе. На бэкенде, где прогон тестов идёт минуты, это заметно.',
      },
      {
        kind: 'note',
        text: 'Тестовую базу этот конфиг поднимает, но не гасит: у проверок нет поля stop, потому что check не держит окружение, а отрабатывает и выходит. Гасите её отдельной командой или используйте --rm в compose-файле.',
      },
    ],
  },
]
