import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { gzipSync } from 'node:zlib'

export interface FileSize {
  path: string
  bytes: number
}

const UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
}

/** '180kb', '1.5 MB', '900' → байты. null, если запись непонятна. */
export function parseSize(raw: string | number): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : null
  const m = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?\s*$/i.exec(raw)
  if (!m?.[1]) return null
  const unit = UNITS[(m[2] ?? 'b').toLowerCase()]
  return unit === undefined ? null : Math.round(Number(m[1]) * unit)
}

export function formatSize(bytes: number): string {
  if (bytes >= UNITS.mb!) return `${(bytes / UNITS.mb!).toFixed(2)}mb`
  if (bytes >= UNITS.kb!) return `${(bytes / UNITS.kb!).toFixed(1)}kb`
  return `${bytes}b`
}

function walk(dir: string, out: string[]) {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out)
    else if (st.isFile()) out.push(full)
  }
}

/**
 * Размер файла или каталога целиком.
 *
 * `gzip` считает сжатый размер каждого файла отдельно и складывает — так же,
 * как их отдаст сервер. Это не то же самое, что архив всего каталога, и
 * бюджеты бандла обычно означают именно это.
 */
export function measure(root: string, target: string, gzip: boolean): { total: number; files: FileSize[] } | null {
  const full = join(root, target)
  let st
  try {
    st = statSync(full)
  } catch {
    return null
  }

  const paths: string[] = []
  if (st.isDirectory()) walk(full, paths)
  else paths.push(full)

  const files: FileSize[] = []
  for (const p of paths) {
    let bytes: number
    try {
      bytes = gzip ? gzipSync(readFileSync(p)).length : statSync(p).size
    } catch {
      continue
    }
    files.push({ path: relative(root, p).split('\\').join('/'), bytes })
  }

  files.sort((a, b) => b.bytes - a.bytes)
  return { total: files.reduce((sum, f) => sum + f.bytes, 0), files }
}
