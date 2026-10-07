// Syntax-highlighted HTML for JSON text (escaped first, so safe to inject).
// Used where a full tree would be too heavy: very large bodies, WS messages.

import { prettyBody } from './json';

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function highlightJsonHtml(s: string): string {
  const pretty = prettyBody(s);
  const t = pretty.trimStart();
  if (!t.startsWith('{') && !t.startsWith('[')) return escapeHtml(pretty);
  return escapeHtml(pretty).replace(
    /&quot;(\\.|[^"\\])*?&quot;(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (m, _g1, _g2, kw) => {
      const cls = m.endsWith(':') ? 'j-key'
        : m.startsWith('&quot;') ? 'j-str'
        : kw === 'true' || kw === 'false' ? 'j-bool'
        : kw === 'null' ? 'j-null'
        : 'j-num';
      return `<span class="${cls}">${m}</span>`;
    },
  );
}
