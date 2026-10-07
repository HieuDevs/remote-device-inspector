// POST /ingest: apps (Dio / OkHttp / Alamofire / Axios interceptors, scripts)
// report their own HTTP traffic as JSON. Field names vary between clients, so
// the common spellings are all accepted.

import type { BodyEncoding, Flow, WsMessage } from '../protocol/flow.js';
import { headerOf, toHeaderList } from '../http/body.js';
import { nextFlowId } from './hub.js';

type Payload = Record<string, any>;

const first = (p: Payload, ...keys: string[]): any => {
  for (const k of keys) if (p[k] != null) return p[k];
  return undefined;
};

const asText = (v: unknown): string => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

const asEnc = (v: unknown): BodyEncoding | undefined => (/^base64$/i.test(String(v ?? '')) ? 'base64' : undefined);

const sizeOf = (body: string, enc?: BodyEncoding): number =>
  enc ? Buffer.from(body, 'base64').length : Buffer.byteLength(body, 'utf8');

/** Split whatever the client sent as "url" into scheme / host / path. */
function splitUrl(urlStr: string, fallbackScheme: string): { scheme: string; host: string; path: string } {
  let scheme = fallbackScheme;
  let host = '';
  let path = '';
  if (!urlStr) return { scheme, host, path };
  try {
    if (urlStr.includes('://')) {
      const u = new URL(urlStr);
      scheme = u.protocol.replace(':', '');
      host = u.host || u.hostname;
      path = (u.pathname || '/') + (u.search || '');
    } else if (urlStr.startsWith('/')) {
      path = urlStr;
    } else if (urlStr.includes('/')) {
      const slash = urlStr.indexOf('/');
      const maybeHost = urlStr.slice(0, slash);
      if (maybeHost.includes('.') || maybeHost.includes(':')) {
        host = maybeHost;
        path = urlStr.slice(slash);
      } else {
        path = '/' + urlStr;
      }
    } else if (urlStr.includes('.')) {
      host = urlStr;
      path = '/';
    } else {
      path = '/' + urlStr;
    }
  } catch {}
  return { scheme, host, path };
}

export function normalizeIngestFlow(p: Payload): Flow {
  const urlStr = String(first(p, 'url', 'uri', 'path', 'endpoint') ?? '').trim();
  const guessed = p.scheme || (urlStr.startsWith('ws://') ? 'ws' : urlStr.startsWith('wss://') ? 'wss' : 'https');
  let { scheme, host, path } = splitUrl(urlStr, guessed);
  if (p.host && !host) host = String(p.host);

  const method = String(p.method || '').toUpperCase();
  const isWs = scheme === 'ws' || scheme === 'wss' || p.type === 'ws' || method === 'WS' || method === 'WSS';
  if (isWs && !scheme.startsWith('ws')) scheme = 'wss';
  if (!host) host = p.app || (isWs ? 'WebSocket' : 'API');
  if (!path) path = '/';

  const reqBody = asText(first(p, 'reqBody', 'requestBody', 'body'));
  const reqEnc = asEnc(first(p, 'reqBodyEnc', 'reqBodyEncoding'));
  const ms = Number(first(p, 'ms', 'durationMs', 'duration') ?? 0) || 0;
  const t = Number(first(p, 't', 'time', 'timestamp')) || Date.now() - ms;

  const messages: WsMessage[] = Array.isArray(p.messages) ? [...p.messages] : [];
  if (p.data != null || p.message != null) {
    messages.push({ dir: p.dir || 'send', data: asText(p.data ?? p.message), t: Number(p.t) || Date.now() });
  }

  const flow: Flow = {
    id: p.id ? String(p.id) : nextFlowId(isWs ? 'ws' : 'ingest'),
    ev: 'txn',
    proto: scheme,
    scheme,
    host,
    path,
    url: urlStr.includes('://') ? urlStr : `${scheme}://${host}${path}`,
    method: isWs ? scheme.toUpperCase() : method || 'GET',
    t,
    ms,
    reqHeaders: toHeaderList(first(p, 'reqHeaders', 'requestHeaders', 'headers')),
    reqBody,
    up: sizeOf(reqBody, reqEnc),
    app: p.app || (isWs ? 'WebSocket' : 'DebugApp'),
    messages,
  };
  if (reqEnc) flow.reqBodyEnc = reqEnc;

  const status = first(p, 'status', 'statusCode', 'code');
  if (status != null) {
    const respBody = asText(first(p, 'respBody', 'resBody', 'responseBody', 'response'));
    const respEnc = asEnc(first(p, 'respBodyEnc', 'respBodyEncoding', 'resBodyEnc', 'resBodyEncoding'));
    flow.status = Number(status);
    flow.respHeaders = toHeaderList(first(p, 'respHeaders', 'resHeaders', 'responseHeaders'));
    flow.respBody = respBody;
    flow.down = sizeOf(respBody, respEnc);
    if (respEnc) flow.respBodyEnc = respEnc;
    const ctype = p.ctype || headerOf(flow.respHeaders, 'content-type');
    if (ctype) flow.ctype = String(ctype);
  } else if (isWs) {
    flow.status = 101; // Switching Protocols
  }
  return flow;
}
