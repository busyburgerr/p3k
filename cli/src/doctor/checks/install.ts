import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Check, Finding } from '../../types.js'

const LOCKS = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb']

/** Установлены ли зависимости и не отстали ли они от локфайла. */
export const installCheck: Check = {
  id: 'deps/install',
  group: 'ЗАВИСИМОСТИ',
  async run(ctx): Promise<Finding[]> {
    const modules = join(ctx.root, 'node_modules')
    if (!existsSync(modules)) {
      return [{ level: 'fail', title: 'node_modules отсутствует', detail: 'зависимости не установлены', fix: 'npm install' }]
    }

    const stamp = join(modules, '.package-lock.json')
    if (!existsSync(stamp)) {
      return [{ level: 'ok', title: 'зависимости установлены', detail: 'отметку об установке проверить не удалось' }]
    }

    const installedAt = statSync(stamp).mtimeMs
    const lock = LOCKS.map((f) => join(ctx.root, f)).find(existsSync)
    const target = lock ?? join(ctx.root, 'package.json')
    if (!existsSync(target)) return [{ level: 'ok', title: 'зависимости установлены' }]

    const changedAt = statSync(target).mtimeMs
    const name = target.slice(ctx.root.length + 1)

    if (changedAt > installedAt + 1000) {
      return [{
        level: 'warn',
        title: 'node_modules отстал',
        detail: `${name} изменён позже последней установки`,
        fix: 'npm install',
      }]
    }
    return [{ level: 'ok', title: 'зависимости установлены', detail: `свежее, чем ${name}` }]
  },
}
