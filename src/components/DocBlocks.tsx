import { docsHref } from '@/composables/useHashRoute'
import type { DocBlock } from '@/data.docs'

const tableGrid = 'display:grid;grid-template-columns:minmax(120px,1fr) minmax(180px,2.4fr);gap:16px;padding:13px clamp(16px,2vw,22px)'

export function renderBlock(block: DocBlock, key: number) {
  if (block.kind === 'text') {
    return (
      <p key={key} style="font-size:13.5px;line-height:1.8;color:var(--muted);max-width:74ch;margin:0;text-wrap:pretty">
        {block.text}
      </p>
    )
  }

  if (block.kind === 'note') {
    return (
      <div
        key={key}
        style="display:flex;gap:14px;font-size:12.5px;line-height:1.75;color:var(--muted);border-left:1px solid var(--accent);padding:2px 0 2px 16px;max-width:74ch;text-wrap:pretty"
      >
        <span>{block.text}</span>
      </div>
    )
  }

  if (block.kind === 'code') {
    return (
      <div key={key} class="win">
        {block.caption && (
          <div class="winbar" style="font-size:10px;letter-spacing:.16em;color:var(--muted)">
            <span>{block.caption}</span>
          </div>
        )}
        <pre style="margin:0;padding:18px clamp(14px,2vw,20px);font-family:'JetBrains Mono',monospace;font-size:clamp(11px,.95vw,12.5px);line-height:1.85;overflow-x:auto">
          {block.lines.join('\n')}
        </pre>
      </div>
    )
  }

  return (
    <div key={key} class="grid">
      <div class="mono11" style={`background:var(--panel);font-size:10px;letter-spacing:.14em;${tableGrid}`}>
        <span>{block.head[0]}</span>
        <span>{block.head[1]}</span>
      </div>
      {block.rows.map((row) => (
        <div key={row[0]} style={`background:var(--bg);font-size:12.5px;line-height:1.65;align-items:baseline;${tableGrid}`}>
          <span style="color:var(--ink)">{row[0]}</span>
          <span style="color:var(--muted)">{row[1]}</span>
        </div>
      ))}
    </div>
  )
}


/** Оглавление по разделам страницы. */
export function docNav(items: { id: string; nav: string }[], route: string) {
  return (
    <nav style="position:sticky;top:88px;display:grid;gap:1px;background:var(--line);border:1px solid var(--line)">
      {items.map((s) => (
        <a
          key={s.id}
          href={route ? docsHref(s.id) : `#${s.id}`}
          style="background:var(--bg);padding:12px 16px;font-size:11.5px;letter-spacing:.1em;color:var(--muted)"
        >
          {s.nav}
        </a>
      ))}
    </nav>
  )
}
