import type { Check, Finding } from '../../types.js'
import { exec } from '../../util/exec.js'

/**
 * Docker проверяется, только если проект на него похож: иначе на обычном
 * фронтенде без контейнеров мы бы ругались на отсутствие ненужного демона.
 */
function usesDocker(files: string[]): boolean {
  return files.some((f) => /^(docker-compose|compose)\.ya?ml$/.test(f) || f === 'Dockerfile' || f === '.dockerignore')
}

export function dockerCheck(files: string[]): Check {
  return {
    id: 'runtime/docker',
    group: 'РАНТАЙМЫ',
    async run(ctx): Promise<Finding[]> {
      void ctx
      if (!usesDocker(files)) {
        return [{ level: 'skip', title: 'Docker', detail: 'в проекте нет Dockerfile и compose-файла — не проверяем' }]
      }
      const version = await exec('docker', ['version', '--format', '{{.Server.Version}}'])
      if (version.missing) {
        return [{
          level: 'fail',
          title: 'Docker не установлен',
          detail: 'исполняемый файл docker не найден в PATH',
          fix: 'установите Docker Desktop или OrbStack и откройте новый терминал',
        }]
      }
      if (!version.ok) {
        const reason = (version.stderr || version.stdout).trim().split('\n')[0] ?? ''
        return [{
          level: 'fail',
          title: 'Docker установлен, но демон не отвечает',
          detail: reason || 'docker version завершился с ошибкой',
          fix: 'запустите Docker Desktop и дождитесь статуса running',
        }]
      }
      return [{ level: 'ok', title: `Docker ${version.stdout.trim()}`, detail: 'демон отвечает' }]
    },
  }
}
