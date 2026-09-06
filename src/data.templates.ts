/** Шаблоны, которые действительно есть в CLI. Проверять: p3k init --list */
export interface Template {
  name: string
  stack: string
  /** Сколько процессов в порождаемом графе — столько же в p3k.json шаблона. */
  processes: string
  needs: string
}

export const templates: Template[] = [
  {
    name: 'static',
    stack: 'Сборка и сервер статики на голом Node. Одноразовый шаг сборки и веб-сервер, который её дожидается.',
    processes: '2 процесса',
    needs: 'без зависимостей',
  },
  {
    name: 'node-postgres',
    stack: 'Postgres в контейнере, шаг миграций и API. Весь граф целиком: база → миграции → сервис.',
    processes: '3 процесса',
    needs: 'нужен Docker',
  },
]
