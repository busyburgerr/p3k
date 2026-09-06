export type Level = 'ok' | 'warn' | 'fail' | 'skip'

export interface Finding {
  level: Level
  /** Что проверяли — одна строка, без подробностей. */
  title: string
  /** Факты, на которых основан вывод. Не догадки. */
  detail?: string
  /** Готовое действие: команда или конкретная правка. */
  fix?: string | string[]
}

export interface ProjectPort {
  port: number
  /** Откуда взяли номер — показываем, чтобы вывод можно было перепроверить. */
  source: string
}

export interface Context {
  root: string
  pkg: Record<string, unknown> | null
  ports: ProjectPort[]
}

export interface Check {
  id: string
  /** Заголовок группы в отчёте. */
  group: string
  run(ctx: Context): Promise<Finding[]>
}
