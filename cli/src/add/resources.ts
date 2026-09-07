/**
 * Ресурсы — куски окружения, которые проект добавляет к себе: база, кэш,
 * хранилище файлов, ловушка для почты, край с прокси.
 *
 * Ресурс описан один раз и знает про оба окружения сразу: сейчас он выдаёт
 * запись в `processes` для локальной разработки, дальше — свою продакшен-форму
 * для выкатки. Смысл в том, что прод перестаёт отличаться от локалки не потому,
 * что мы аккуратно переписали конфиг дважды, а потому что источник один.
 *
 * Значения здесь намеренно небезопасные — пароль `dev`, ключи `minioadmin`.
 * Это контейнеры, которые живут полчаса на localhost; секреты продакшена
 * приходят из другого места и в конфиг проекта не попадают.
 */

export interface PortSpec {
  id: string
  port: number
  /** Что за порт — попадает в подсказки и в сообщение о занятости. */
  what: string
  /**
   * Ресурс сам занимает этот порт. false — порт чужой, ресурс только ходит
   * по нему: апстримы прокси заняты приложением, и это норма, а не конфликт.
   */
  bind: boolean
}

export interface ResourceOpts {
  /** Имя процесса в конфиге. */
  name: string
  /** Имя контейнера: <проект>-<имя процесса>. */
  container: string
  /** Имя проекта — попадает в имя базы и корзины. */
  project: string
  /** Итоговые номера портов после разбора --port. */
  ports: Record<string, number>
}

/**
 * Продакшен-форма ресурса.
 *
 * Та же служба, но с поправками, которые на localhost не нужны, а на сервере
 * обязательны: перезапуск после падения, порт только на петле, пароль не из
 * конфига, а из файла на сервере.
 */
export interface ProdForm {
  /** Запись службы в compose-файле. */
  service: Record<string, unknown>
  /** Именованные тома, которые нужно объявить в compose. */
  volumes: string[]
  /**
   * Что приложение должно получить из shared/.env на сервере.
   * Значения с угловыми скобками — заготовки: их заполняет человек.
   */
  env: Record<string, string>
  /** Файлы в shared/ на сервере. */
  files?: Record<string, string>
}

export interface Resource {
  id: string
  title: string
  summary: string
  requires: string | null
  ports: PortSpec[]
  /**
   * Форма для сервера, или null — если ресурсу там делать нечего.
   * Ловушка для писем в проде означала бы, что почта никуда не уходит.
   */
  prod: ((o: ResourceOpts) => ProdForm) | null
  /** Запись в processes конфига. */
  process(o: ResourceOpts): Record<string, unknown>
  /** Переменные, которые ресурс даёт приложению: имя → значение для локалки. */
  env(o: ResourceOpts): Record<string, string>
  /** Файлы рядом с конфигом, без которых ресурс не поднимется. */
  files?(o: ResourceOpts): Record<string, string>
  /** Что стоит знать до первого запуска. Печатается после добавления. */
  notes: string[]
}

/** Порт по идентификатору. Отсутствие — ошибка в самом каталоге, не в конфиге. */
function port(o: ResourceOpts, id: string): number {
  const value = o.ports[id]
  if (value === undefined) throw new Error(`ресурс не получил порт "${id}"`)
  return value
}

/**
 * Локальный том для данных.
 *
 * Контейнер запускается с --rm и исчезает после Ctrl+C, а том остаётся: иначе
 * база пересоздавалась бы при каждом запуске, и наполнить её для отладки было
 * бы нечем.
 */
const volume = (o: ResourceOpts, path: string) => `-v ${o.container}-data:${path} `

/** Порт наружу не выставляем: база должна быть видна только с самого сервера. */
const loopback = (o: ResourceOpts, id: string, inner: number) => [`127.0.0.1:${port(o, id)}:${inner}`]

/** Служба должна пережить перезагрузку сервера — иначе прод держится на удаче. */
const service = (extra: Record<string, unknown>) => ({ restart: 'unless-stopped', ...extra })

const healthcheck = (test: string) => ({
  test: ['CMD-SHELL', test],
  interval: '5s',
  timeout: '3s',
  retries: 20,
})

const NGINX_CONF = (web: number, api: number) => `# Локальный край: один адрес на фронтенд и API, как будет в проде.
# Приложения остаются на хосте, поэтому обращаемся к host.docker.internal —
# на Linux этот адрес появляется благодаря --add-host в команде запуска.

server {
  listen 80;
  server_name _;

  # Пустой ответ для проверки готовности: без него ready ловил бы 502, пока
  # приложение ещё не поднялось, и считал бы сломанным сам прокси.
  location = /healthz {
    add_header Content-Type text/plain;
    return 200 "ok\\n";
  }

  location /api/ {
    proxy_pass http://host.docker.internal:${api}/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    proxy_pass http://host.docker.internal:${web};
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Вебсокеты нужны любому дев-серверу: без них не работает горячая замена.
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
`

export const RESOURCES: Resource[] = [
  {
    id: 'postgres',
    title: 'PostgreSQL 16',
    summary: 'база в контейнере, данные переживают перезапуск',
    requires: 'Docker',
    ports: [{ id: 'port', port: 5432, what: 'подключение к базе', bind: true }],
    process: (o) => ({
      command:
        `docker run --rm --name ${o.container} -p ${port(o, 'port')}:5432 ` +
        `-e POSTGRES_PASSWORD=dev -e POSTGRES_DB=${o.project} ` +
        volume(o, '/var/lib/postgresql/data') +
        'postgres:16',
      // Порт открывается ещё во время инициализации кластера, поэтому
      // { "port": 5432 } пропустил бы миграции вперёд самой базы.
      ready: { exec: `docker exec ${o.container} pg_isready -U postgres` },
      stop: `docker stop ${o.container}`,
    }),
    env: (o) => ({
      DATABASE_URL: `postgres://postgres:dev@localhost:${port(o, 'port')}/${o.project}`,
    }),
    prod: (o) => ({
      service: service({
        image: 'postgres:16',
        environment: {
          POSTGRES_PASSWORD: '${POSTGRES_PASSWORD:?нет в shared/.env}',
          POSTGRES_DB: o.project,
        },
        volumes: [`${o.name}-data:/var/lib/postgresql/data`],
        ports: loopback(o, 'port', 5432),
        healthcheck: healthcheck('pg_isready -U postgres'),
      }),
      volumes: [`${o.name}-data`],
      env: {
        POSTGRES_PASSWORD: '<придумайте длинный пароль>',
        DATABASE_URL: `postgres://postgres:<тот же пароль>@localhost:${port(o, 'port')}/${o.project}`,
      },
    }),
    notes: [
      'Данные лежат в томе и переживают перезапуск. Начать с чистой базы: docker volume rm <контейнер>-data',
    ],
  },

  {
    id: 'mysql',
    title: 'MySQL 8',
    summary: 'база в контейнере, данные переживают перезапуск',
    requires: 'Docker',
    ports: [{ id: 'port', port: 3306, what: 'подключение к базе', bind: true }],
    process: (o) => ({
      command:
        `docker run --rm --name ${o.container} -p ${port(o, 'port')}:3306 ` +
        `-e MYSQL_ROOT_PASSWORD=dev -e MYSQL_DATABASE=${o.project} ` +
        volume(o, '/var/lib/mysql') +
        'mysql:8',
      ready: { exec: `docker exec ${o.container} mysqladmin ping -h 127.0.0.1 -uroot -pdev --silent` },
      stop: `docker stop ${o.container}`,
    }),
    env: (o) => ({
      DATABASE_URL: `mysql://root:dev@localhost:${port(o, 'port')}/${o.project}`,
    }),
    prod: (o) => ({
      service: service({
        image: 'mysql:8',
        environment: {
          MYSQL_ROOT_PASSWORD: '${MYSQL_ROOT_PASSWORD:?нет в shared/.env}',
          MYSQL_DATABASE: o.project,
        },
        volumes: [`${o.name}-data:/var/lib/mysql`],
        ports: loopback(o, 'port', 3306),
        healthcheck: healthcheck('mysqladmin ping -h 127.0.0.1 -uroot -p"$$MYSQL_ROOT_PASSWORD" --silent'),
      }),
      volumes: [`${o.name}-data`],
      env: {
        MYSQL_ROOT_PASSWORD: '<придумайте длинный пароль>',
        DATABASE_URL: `mysql://root:<тот же пароль>@localhost:${port(o, 'port')}/${o.project}`,
      },
    }),
    notes: [
      'Первый запуск дольше остальных: MySQL создаёт системные таблицы. Проверка готовности ждёт столько, сколько нужно.',
    ],
  },

  {
    id: 'redis',
    title: 'Redis 7',
    summary: 'кэш и очереди, без тома — содержимое одноразовое',
    requires: 'Docker',
    ports: [{ id: 'port', port: 6379, what: 'подключение к кэшу', bind: true }],
    process: (o) => ({
      command: `docker run --rm --name ${o.container} -p ${port(o, 'port')}:6379 redis:7`,
      ready: { exec: `docker exec ${o.container} redis-cli ping` },
      stop: `docker stop ${o.container}`,
    }),
    env: (o) => ({ REDIS_URL: `redis://localhost:${port(o, 'port')}` }),
    prod: (o) => ({
      service: service({
        image: 'redis:7',
        // В проде кэш переживает перезапуск: терять его на каждом обновлении
        // означает добровольно устраивать себе всплеск нагрузки на базу.
        command: 'redis-server --save 60 1',
        volumes: [`${o.name}-data:/data`],
        ports: loopback(o, 'port', 6379),
        healthcheck: healthcheck('redis-cli ping'),
      }),
      volumes: [`${o.name}-data`],
      env: { REDIS_URL: `redis://localhost:${port(o, 'port')}` },
    }),
    notes: [
      'Тома нет намеренно: кэш, переживающий перезапуск, прячет ошибки вида «работает только со вчерашними данными».',
    ],
  },

  {
    id: 'mailpit',
    title: 'Mailpit',
    summary: 'ловушка для писем: приложение шлёт почту, наружу она не уходит',
    requires: 'Docker',
    ports: [
      { id: 'smtp', port: 1025, what: 'SMTP для приложения', bind: true },
      { id: 'web', port: 8025, what: 'веб-интерфейс с письмами', bind: true },
    ],
    process: (o) => ({
      command:
        `docker run --rm --name ${o.container} ` +
        `-p ${port(o, 'smtp')}:1025 -p ${port(o, 'web')}:8025 axllent/mailpit`,
      ready: { http: `http://localhost:${port(o, 'web')}/` },
      stop: `docker stop ${o.container}`,
    }),
    env: (o) => ({
      SMTP_HOST: 'localhost',
      SMTP_PORT: String(port(o, 'smtp')),
      SMTP_FROM: 'dev@localhost',
    }),
    // В проде ловушка означала бы, что письма клиентам никуда не уходят.
    prod: null,
    notes: [
      'Письма видны в браузере и никуда не отправляются — можно отлаживать рассылку на настоящих адресах.',
      'На сервер этот ресурс не поедет: там нужен настоящий отправитель почты.',
    ],
  },

  {
    id: 'minio',
    title: 'MinIO',
    summary: 'хранилище файлов с тем же API, что у S3',
    requires: 'Docker',
    ports: [
      { id: 'api', port: 9000, what: 'S3 API', bind: true },
      { id: 'console', port: 9001, what: 'веб-консоль', bind: true },
    ],
    process: (o) => ({
      command:
        `docker run --rm --name ${o.container} ` +
        `-p ${port(o, 'api')}:9000 -p ${port(o, 'console')}:9001 ` +
        '-e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin ' +
        volume(o, '/data') +
        'minio/minio server /data --console-address ":9001"',
      ready: { http: `http://localhost:${port(o, 'api')}/minio/health/live` },
      stop: `docker stop ${o.container}`,
    }),
    env: (o) => ({
      S3_ENDPOINT: `http://localhost:${port(o, 'api')}`,
      S3_ACCESS_KEY: 'minioadmin',
      S3_SECRET_KEY: 'minioadmin',
      S3_BUCKET: o.project,
      S3_FORCE_PATH_STYLE: 'true',
    }),
    prod: (o) => ({
      service: service({
        image: 'minio/minio',
        command: 'server /data --console-address ":9001"',
        environment: {
          MINIO_ROOT_USER: '${MINIO_ROOT_USER:?нет в shared/.env}',
          MINIO_ROOT_PASSWORD: '${MINIO_ROOT_PASSWORD:?нет в shared/.env}',
        },
        volumes: [`${o.name}-data:/data`],
        ports: [...loopback(o, 'api', 9000), ...loopback(o, 'console', 9001)],
        healthcheck: healthcheck('mc ready local || curl -f http://localhost:9000/minio/health/live'),
      }),
      volumes: [`${o.name}-data`],
      env: {
        MINIO_ROOT_USER: '<имя учётной записи>',
        MINIO_ROOT_PASSWORD: '<придумайте длинный пароль>',
        S3_ENDPOINT: `http://localhost:${port(o, 'api')}`,
        S3_ACCESS_KEY: '<то же имя>',
        S3_SECRET_KEY: '<тот же пароль>',
        S3_BUCKET: o.project,
        S3_FORCE_PATH_STYLE: 'true',
      },
    }),
    notes: [
      'Корзину создайте сами — MinIO не делает этого за вас. Консоль на порту 9001, вход minioadmin / minioadmin.',
      'S3_FORCE_PATH_STYLE обязателен: MinIO не понимает адреса вида bucket.host.',
    ],
  },

  {
    id: 'nginx',
    title: 'nginx',
    summary: 'один адрес на фронтенд и API — как будет в проде',
    requires: 'Docker',
    ports: [
      { id: 'port', port: 8080, what: 'общий вход', bind: true },
      { id: 'web', port: 3000, what: 'фронтенд на хосте', bind: false },
      { id: 'api', port: 4000, what: 'API на хосте', bind: false },
    ],
    process: (o) => ({
      command:
        `docker run --rm --name ${o.container} -p ${port(o, 'port')}:80 ` +
        '--add-host=host.docker.internal:host-gateway ' +
        '-v ./nginx.dev.conf:/etc/nginx/conf.d/default.conf:ro ' +
        'nginx:1.27-alpine',
      ready: { http: `http://localhost:${port(o, 'port')}/healthz` },
      stop: `docker stop ${o.container}`,
    }),
    env: (o) => ({ PUBLIC_URL: `http://localhost:${port(o, 'port')}` }),
    files: (o) => ({ 'nginx.dev.conf': NGINX_CONF(port(o, 'web'), port(o, 'api')) }),
    prod: (o) => ({
      service: service({
        image: 'nginx:1.27-alpine',
        // Приложение живёт на самом сервере, а не в compose, поэтому прокси
        // нужен путь к хосту: на Linux его даёт host-gateway.
        extra_hosts: ['host.docker.internal:host-gateway'],
        volumes: ['./nginx.conf:/etc/nginx/conf.d/default.conf:ro'],
        ports: [`80:80`],
        healthcheck: healthcheck('wget -q -O - http://localhost/healthz'),
      }),
      volumes: [],
      env: { PUBLIC_URL: '<https://ваш-домен>' },
      files: { 'nginx.conf': NGINX_CONF(port(o, 'web'), port(o, 'api')) },
    }),
    notes: [
      'Правила лежат в nginx.dev.conf — это обычный конфиг nginx, правьте как есть.',
      'Относительный путь в -v требует Docker 23 или новее.',
    ],
  },
]

export const findResource = (id: string) => RESOURCES.find((r) => r.id === id) ?? null
