import type { Finding, Level } from '../types.js'
import { plural } from '../util/plural.js'

const useColor = process.stdout.isTTY && !process.env.NO_COLOR

const paint = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)
const dim = (s: string) => paint('2', s)
const bold = (s: string) => paint('1', s)

const MARK: Record<Level, string> = {
  ok: paint('32', '✓'),
  warn: paint('33', '!'),
  fail: paint('31', '✗'),
  skip: dim('·'),
}

export interface GroupResult {
  group: string
  findings: Finding[]
}

function indent(text: string, pad: string): string {
  return text
    .split('\n')
    .map((l) => pad + l)
    .join('\n')
}

export function renderHuman(groups: GroupResult[], counts: Record<Level, number>, skipped: string[]): string {
  const lines: string[] = ['']

  for (const { group, findings } of groups) {
    if (findings.length === 0) continue
    lines.push(`  ${bold(group)}`)
    for (const f of findings) {
      lines.push(`  ${MARK[f.level]}  ${f.level === 'skip' ? dim(f.title) : f.title}`)
      if (f.detail) lines.push(dim(indent(f.detail, '     ')))
      if (f.fix) {
        for (const fix of Array.isArray(f.fix) ? f.fix : [f.fix]) {
          lines.push(paint('36', indent(`→ ${fix}`, '     ')))
        }
      }
    }
    lines.push('')
  }

  const parts: string[] = []
  if (counts.fail) parts.push(paint('31', plural(counts.fail, 'проблема блокирует', 'проблемы блокируют', 'проблем блокируют') + ' запуск'))
  if (counts.warn) parts.push(paint('33', plural(counts.warn, 'предупреждение', 'предупреждения', 'предупреждений')))
  if (counts.ok) parts.push(dim(`${counts.ok} в порядке`))
  lines.push(`  ${parts.join(' · ') || dim('нечего проверять')}`)

  if (skipped.length) {
    lines.push(dim(`  не проверялось: ${skipped.join(', ')}`))
  }
  lines.push('')
  return lines.join('\n')
}

export function renderJson(groups: GroupResult[], counts: Record<Level, number>, skipped: string[]): string {
  return JSON.stringify({ groups, counts, skipped }, null, 2)
}
