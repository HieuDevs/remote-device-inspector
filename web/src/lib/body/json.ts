// Lossless JSON: keeps every literal exactly as sent (big integer IDs, number
// formatting, string escapes) — JSON.parse + JSON.stringify would round
// 1234567890123456789 to 1234567890123456800.

export type JsonNode =
  | { t: 'o'; e: [key: string, value: JsonNode][] }
  | { t: 'a'; e: [key: null, value: JsonNode][] }
  | { t: 's' | 'n' | 'b' | 'z'; v: string };

export function parseJsonLossless(s: string): JsonNode {
  let i = 0;
  const num = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const fail = (): never => { throw new SyntaxError(`Invalid JSON at position ${i}`); };
  const ws = () => {
    for (;;) {
      const c = s.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 0xfeff) i++;
      else break;
    }
  };
  const str = (): string => {
    const st = i++;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\') i += 2;
      else if (c === '"') return s.slice(st, ++i);
      else i++;
    }
    return fail();
  };
  const val = (): JsonNode => {
    ws();
    const c = s[i];
    if (c === '{' || c === '[') {
      const arr = c === '[';
      const close = arr ? ']' : '}';
      const e: [string | null, JsonNode][] = [];
      i++;
      ws();
      if (s[i] === close) { i++; return (arr ? { t: 'a', e } : { t: 'o', e }) as JsonNode; }
      for (;;) {
        let k: string | null = null;
        if (!arr) {
          ws();
          if (s[i] !== '"') fail();
          k = str();
          ws();
          if (s[i++] !== ':') fail();
        }
        e.push([k, val()]);
        ws();
        const d = s[i++];
        if (d === ',') continue;
        if (d === close) break;
        fail();
      }
      return (arr ? { t: 'a', e } : { t: 'o', e }) as JsonNode;
    }
    if (c === '"') return { t: 's', v: str() };
    if (s.startsWith('true', i)) { i += 4; return { t: 'b', v: 'true' }; }
    if (s.startsWith('false', i)) { i += 5; return { t: 'b', v: 'false' }; }
    if (s.startsWith('null', i)) { i += 4; return { t: 'z', v: 'null' }; }
    num.lastIndex = i;
    const m = num.exec(s);
    if (!m) fail();
    i += m![0].length;
    return { t: 'n', v: m![0] };
  };
  const v = val();
  ws();
  if (i !== s.length) fail();
  return v;
}

export function tryJson(s: string): JsonNode | null {
  const t = s.trimStart();
  if (t[0] !== '{' && t[0] !== '[' && t[0] !== '"') return null;
  try { return parseJsonLossless(s); } catch { return null; }
}

/** Two-space indented text, literals untouched. */
export function jsonText(n: JsonNode, ind = 0): string {
  if (n.t !== 'o' && n.t !== 'a') return n.v;
  const [o, c] = n.t === 'a' ? ['[', ']'] : ['{', '}'];
  if (!n.e.length) return o + c;
  const pad = '  '.repeat(ind + 1);
  const items = n.e.map(([k, v]) => pad + (k != null ? `${k}: ` : '') + jsonText(v, ind + 1));
  return `${o}\n${items.join(',\n')}\n${'  '.repeat(ind)}${c}`;
}

/** Pretty text for any body string (lossless for JSON, unchanged otherwise). */
export function prettyBody(s: string): string {
  const n = tryJson(s);
  return n ? jsonText(n) : s;
}
