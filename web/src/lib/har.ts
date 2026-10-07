// HAR 1.2 export of the HTTP(S)/WS flows, for Charles / Postman / Insomnia.

import type { Flow } from '@proto/flow';
import { byteLen } from './format';
import { headerVal, methodOf, schemeOf, urlOf } from './flow';

export function buildHar(flows: Flow[]): object | null {
  const entries = [];
  for (const r of flows) {
    const sc = schemeOf(r);
    if (sc !== 'http' && sc !== 'https' && sc !== 'ws' && sc !== 'wss' && !r.url) continue;

    const queryString: { name: string; value: string }[] = [];
    try { new URL(urlOf(r)).searchParams.forEach((value, name) => queryString.push({ name, value })); } catch {}

    const reqBody = r.reqBody || '';
    const respBody = r.respBody || '';
    const respSize = r.down || byteLen(respBody);
    const duration = r.ms || 0;
    const wait = r.ttfb ?? Math.round(duration * 0.4);

    entries.push({
      startedDateTime: new Date(r.t || Date.now()).toISOString(),
      time: duration,
      request: {
        method: methodOf(r),
        url: urlOf(r),
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: (r.reqHeaders || []).map(([name, value]) => ({ name, value })),
        queryString,
        postData: reqBody
          ? { mimeType: headerVal(r.reqHeaders, 'content-type') || r.ctype || 'application/json', text: reqBody }
          : undefined,
        headersSize: -1,
        bodySize: r.up || byteLen(reqBody),
      },
      response: {
        status: r.status || (r.ev === 'close' ? 200 : 0),
        statusText: r.statusText || (r.status === 200 ? 'OK' : ''),
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: (r.respHeaders || []).map(([name, value]) => ({ name, value })),
        content: {
          size: respSize,
          mimeType: headerVal(r.respHeaders, 'content-type') || r.ctype || 'application/octet-stream',
          text: respBody,
          ...(r.respBodyEnc === 'base64' ? { encoding: 'base64' } : {}),
        },
        redirectURL: '',
        headersSize: -1,
        bodySize: respSize,
      },
      cache: {},
      timings: { blocked: -1, dns: -1, connect: -1, send: 0, wait, receive: Math.max(0, duration - wait), ssl: -1 },
      serverIPAddress: r.dstIp || undefined,
      connection: String(r.id),
    });
  }
  if (!entries.length) return null;
  return { log: { version: '1.2', creator: { name: 'Device Inspector', version: '0.2.0' }, pages: [], entries } };
}
