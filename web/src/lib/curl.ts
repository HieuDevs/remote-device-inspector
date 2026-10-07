// cURL <-> request. Parsing accepts what Chrome DevTools / Postman / a terminal
// produce; building writes one flag per line so the command stays readable.

import type { Flow, Header } from '@proto/flow';
import { urlOf } from './flow';

export interface ParsedCurl {
  scheme: string;
  host: string;
  path: string;
  url: string;
  method: string;
  reqHeaders: Header[];
  reqBody: string | null;
}

// Shell-safe single quoting: ' → '\''
const shq = (v: string): string => `'${String(v).replace(/'/g, "'\\''")}'`;

export function curlOf(r: Flow): string {
  const lines = [`curl ${shq(urlOf(r))}`];
  const m = r.method || 'GET';
  if (m !== 'GET') lines.push(`-X ${m}`);
  for (const [k, v] of r.reqHeaders || []) {
    // Let curl compute these; copying them verbatim breaks replay.
    if (/^(content-length|host|connection|accept-encoding)$/i.test(k)) continue;
    lines.push(`-H ${shq(`${k}: ${v}`)}`);
  }
  if (r.reqBody && !r.reqBodyEnc) lines.push(`--data-raw ${shq(r.reqBody)}`);
  return lines.join(' \\\n  ');
}

// Split a shell-ish command respecting single/double quotes, backslash escapes
// inside double quotes, and backslash-newline line continuations.
function tokenize(text: string): string[] {
  const s = text.replace(/\\\r?\n/g, ' ');
  const tokens: string[] = [];
  let cur = '';
  let inS = false;
  let inD = false;
  let has = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inS) { if (c === "'") inS = false; else cur += c; continue; }
    if (inD) {
      if (c === '"') inD = false;
      else if (c === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) cur += s[++i];
      else cur += c;
      continue;
    }
    if (c === "'") { inS = true; has = true; }
    else if (c === '"') { inD = true; has = true; }
    else if (c === '\\' && i + 1 < s.length) { cur += s[++i]; has = true; }
    else if (/\s/.test(c)) { if (has) { tokens.push(cur); cur = ''; has = false; } }
    else { cur += c; has = true; }
  }
  if (has) tokens.push(cur);
  return tokens;
}

const NO_ARG_FLAGS = new Set(['--compressed', '--location', '-L', '-s', '-S', '-k', '--insecure', '-i', '-v']);
const DATA_FLAGS = new Set(['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode']);

/** Throws an Error with a user-facing message when the text is not a usable cURL. */
export function parseCurl(text: string): ParsedCurl {
  const t = tokenize(text.trim());
  if (!t.length) throw new Error('Empty. Paste a curl command.');
  if (!/^curl$/i.test(t[0])) {
    if (/^https?:\/\//i.test(t[0])) t.unshift('curl'); // a bare URL is fine too
    else throw new Error('No curl command found. Paste a command that starts with "curl …".');
  }
  let method: string | null = null;
  let url: string | null = null;
  let body: string | null = null;
  const headers: Header[] = [];
  for (let i = 1; i < t.length; i++) {
    const a = t[i];
    const val = () => t[++i] ?? '';
    if (a === '-X' || a === '--request') method = val();
    else if (a === '-H' || a === '--header') {
      const h = val();
      const idx = h.indexOf(':');
      if (idx > 0) headers.push([h.slice(0, idx).trim(), h.slice(idx + 1).trim()]);
    } else if (DATA_FLAGS.has(a)) body = (body != null ? body + '&' : '') + val();
    else if (a === '--url') url = val();
    else if (a === '-b' || a === '--cookie') headers.push(['cookie', val()]);
    else if (a === '-A' || a === '--user-agent') headers.push(['user-agent', val()]);
    else if (a === '-e' || a === '--referer') headers.push(['referer', val()]);
    else if (a === '-u' || a === '--user') {
      const cred = val();
      try { headers.push(['authorization', 'Basic ' + btoa(cred)]); } catch {}
    } else if (NO_ARG_FLAGS.has(a) || a.startsWith('-')) {
      // ignored (an unknown flag's value, if any, stays as a token)
    } else if (!url) url = a;
  }
  if (!url) throw new Error('No URL found in the command.');
  if (!/:\/\//.test(url)) url = 'https://' + url;
  let u: URL;
  try { u = new URL(url); } catch { throw new Error('Invalid URL: ' + url); }
  return {
    scheme: u.protocol.replace(':', ''),
    host: u.host,
    path: (u.pathname || '/') + (u.search || ''),
    url: u.href,
    method: (method || (body != null ? 'POST' : 'GET')).toUpperCase(),
    reqHeaders: headers,
    reqBody: body,
  };
}
