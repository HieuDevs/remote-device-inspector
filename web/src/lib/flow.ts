// Display helpers for a flow record (see Flow in @proto/flow).

import type { Flow, Header } from '@proto/flow';

export const schemeOf = (r: Flow): string => r.scheme || r.proto || 'tcp';
export const hostOf = (r: Flow): string => r.host || r.dstIp || '?';
export const methodOf = (r: Flow): string => r.method || (r.proto === 'dns' ? 'Q' : schemeOf(r).toUpperCase());
export const isHttp = (r: Flow): boolean => r.scheme === 'http' || r.scheme === 'https';
export const isWs = (r: Flow): boolean =>
  r.scheme === 'ws' || r.scheme === 'wss' || r.proto === 'ws' || r.proto === 'wss' || !!r.messages?.length;
/** Still receiving: no final event yet, or a stream that is open. */
export const isLive = (r: Flow): boolean =>
  !!r.streaming || !(r.ev === 'close' || r.status || r.proto === 'dns' || r.imported);

export function headerVal(headers: Header[] | undefined, name: string): string {
  const n = name.toLowerCase();
  const hit = (headers || []).find(([k]) => String(k).toLowerCase() === n);
  return hit ? String(hit[1]) : '';
}

export const headersText = (h: Header[] | undefined): string => (h || []).map(([k, v]) => `${k}: ${v}`).join('\n');

/** Host (dimmed) + path (emphasised) for the name column. */
export function nameParts(r: Flow): { host: string; path: string } {
  let host = r.host || '';
  let path = r.path || '';
  if (r.url) {
    try {
      if (r.url.includes('://')) {
        const u = new URL(r.url);
        if (!host) host = u.host || u.hostname;
        if (!path || path === '/') path = (u.pathname || '/') + (u.search || '');
      } else if (r.url.startsWith('/')) {
        if (!path) path = r.url;
      } else if (r.url.includes('/')) {
        const slash = r.url.indexOf('/');
        const maybeHost = r.url.slice(0, slash);
        if (maybeHost.includes('.') || maybeHost.includes(':')) {
          if (!host) host = maybeHost;
          if (!path) path = r.url.slice(slash);
        } else if (!path) {
          path = '/' + r.url;
        }
      } else if (r.url.includes('.')) {
        if (!host) host = r.url;
      } else if (!path) {
        path = '/' + r.url;
      }
    } catch {}
  }
  if (!host) host = r.dstIp || '';
  if (r.proto === 'dns') return { host: '', path: host || path || 'DNS Query' };
  if (path && !host) host = r.app || 'API';
  if (host && !path) path = r.dstPort && r.dstPort !== 80 && r.dstPort !== 443 ? `:${r.dstPort}` : '/';
  if (!host && !path) {
    if (r.dstIp) {
      host = r.dstIp;
      path = r.dstPort ? `:${r.dstPort}` : '';
    } else {
      host = r.app || 'App';
      path = r.id ? `#${r.id}` : '/endpoint';
    }
  }
  return { host, path };
}

export const nameOf = (r: Flow): string => {
  const p = nameParts(r);
  return p.host + p.path;
};

export function typeOf(r: Flow): string {
  if (r.scheme === 'ws' || r.scheme === 'wss' || r.proto === 'ws' || r.proto === 'wss') return 'ws';
  if (r.ctype) return r.ctype.split(';')[0];
  if (r.scheme === 'https') return 'tls';
  if (r.proto === 'dns') return 'dns';
  return r.proto || '';
}

export function urlOf(r: Flow): string {
  if (r.url) return r.url;
  const sc = schemeOf(r);
  if (sc === 'http' || sc === 'https' || sc === 'ws' || sc === 'wss') return `${sc}://${hostOf(r)}${r.path || ''}`;
  return `${hostOf(r)}:${r.dstPort}`;
}

/** Short label for the type column (full content type goes in the tooltip). */
export function typeLabel(r: Flow): string {
  const t = typeOf(r).toLowerCase();
  if (!t.includes('/')) return t;
  const [main, sub = ''] = t.split('/');
  if (sub.includes('json')) return sub.includes('nd') || sub.includes('stream') ? 'ndjson' : 'json';
  if (sub === 'event-stream') return 'sse';
  if (sub === 'x-www-form-urlencoded') return 'form';
  if (sub === 'form-data') return 'multipart';
  if (sub.includes('svg')) return 'svg';
  if (sub.includes('xml')) return 'xml';
  if (sub.includes('javascript') || sub.includes('ecmascript')) return 'js';
  if (sub === 'octet-stream') return 'binary';
  if (main === 'text' && sub === 'plain') return 'text';
  if (main === 'font') return 'font';
  return sub.replace(/^x-/, '');
}
