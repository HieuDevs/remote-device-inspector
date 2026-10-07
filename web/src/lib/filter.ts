// List filtering: a chip (kind), an app, and a free-text query where
// space-separated terms must all match. Smart terms:
//   slow · pinned · ms:>500 / time:<200 · size:>50kb · status:4xx|5xx|err|>399
//   method:post · host:api · app:shop · type:json · anything else = full text

import type { Flow } from '@proto/flow';
import { hostOf, methodOf, nameOf, schemeOf, typeOf } from './flow';

export type FilterKind = 'all' | 'pinned' | 'https' | 'http' | 'ws' | 'dns' | 'err';

export interface FilterState {
  text: string;
  kind: FilterKind;
  app: string;
}

// Everything searchable about a flow, built lazily (only for free-text terms).
function haystack(r: Flow): string {
  const parts: unknown[] = [nameOf(r), r.dstIp, r.app, methodOf(r), r.status, r.ctype];
  for (const [k, v] of r.reqHeaders || []) parts.push(k, v);
  for (const [k, v] of r.respHeaders || []) parts.push(k, v);
  if (r.reqBody && !r.reqBodyEnc) parts.push(r.reqBody);
  if (r.respBody && !r.respBodyEnc) parts.push(r.respBody);
  return parts.filter((x) => x != null && x !== '').join(' ').toLowerCase();
}

const cmp = (op: string, a: number, b: number): boolean =>
  op === '<' ? a < b : op === '=' ? a === b : a > b;

function matchTerm(r: Flow, term: string, hay: () => string): boolean {
  if (term === 'slow') return (r.ms || 0) >= 800;
  if (term === 'pinned') return !!r.pinned;

  const tm = term.match(/^(?:ms|time):([><=]?)(\d+)$/);
  if (tm) return cmp(tm[1] || '>', r.ms || 0, Number(tm[2]));

  const sz = term.match(/^size:([><=]?)(\d+(?:\.\d+)?)(k|kb|m|mb)?$/);
  if (sz) {
    let num = parseFloat(sz[2]);
    if (sz[3]?.startsWith('k')) num *= 1024;
    else if (sz[3]?.startsWith('m')) num *= 1024 * 1024;
    const size = (r.up || 0) + (r.down || 0);
    return sz[1] === '=' ? Math.round(size) === Math.round(num) : cmp(sz[1] || '>', size, num);
  }

  const st = term.match(/^status:([2345]xx|err|[><=]?\d+)$/);
  if (st) {
    const p = st[1];
    const status = Number(r.status || 0);
    if (/^[2345]xx$/.test(p)) return Math.floor(status / 100) === Number(p[0]);
    if (p === 'err') return status >= 400 || r.ev === 'error';
    if (p[0] === '>' || p[0] === '<') return cmp(p[0], status, Number(p.slice(1)));
    return status === Number(p.replace('=', ''));
  }

  const f = term.match(/^(status|method|host|app|type):(.+)$/);
  if (f) {
    const [, field, val] = f;
    const v =
      field === 'status' ? String(r.status || '')
      : field === 'method' ? methodOf(r).toLowerCase()
      : field === 'host' ? hostOf(r).toLowerCase()
      : field === 'app' ? (r.app || '').toLowerCase()
      : typeOf(r).toLowerCase();
    return v.includes(val);
  }
  return hay().includes(term);
}

export function matches(r: Flow, f: FilterState): boolean {
  if (f.kind === 'pinned' && !r.pinned) return false;
  // Pasted/run cURL rows skip the kind/app filters (they stay visible as a
  // reference) but honour the text search — that is how you search inside a
  // run response's body.
  if (!r.imported) {
    const sc = schemeOf(r);
    if (f.kind === 'err') { if (!((r.status ?? 0) >= 400)) return false; }
    else if (f.kind === 'ws') { if (sc !== 'ws' && sc !== 'wss' && r.proto !== 'ws' && r.proto !== 'wss') return false; }
    else if (f.kind !== 'all' && f.kind !== 'pinned' && sc !== f.kind) return false;
    if (f.app && r.app !== f.app) return false;
  }
  const text = f.text.trim().toLowerCase();
  if (!text) return true;
  let hay: string | null = null;
  const getHay = () => (hay ??= haystack(r));
  return text.split(/\s+/).every((term) => matchTerm(r, term, getHay));
}
