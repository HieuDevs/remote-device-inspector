// cURL runner: the viewer POSTs a parsed request and the relay performs it (the
// browser cannot, due to CORS). A developer inspection aid: it fetches any URL
// the relay can reach, so run the relay only on a trusted network.

import http from 'node:http';
import https from 'node:https';
import type { ExecResult, ExecSpec } from '../protocol/flow.js';
import { EXEC_TIMEOUT_MS } from '../config.js';
import { encodeBody, toHeaderList } from './body.js';

export function execRequest(spec: ExecSpec): Promise<ExecResult> {
  return new Promise((resolve) => {
    let u: URL;
    try { u = new URL(spec.url); } catch { return resolve({ ok: false, error: 'Invalid URL' }); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return resolve({ ok: false, error: 'Only http and https protocols are supported' });
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of spec.headers || []) if (k) headers[k] = v;
    const started = Date.now();
    let firstByteAt = 0;
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, {
      method: (spec.method || 'GET').toUpperCase(),
      headers,
      rejectUnauthorized: false, // accept self-signed upstreams — it's a dev tool
    }, (resp) => {
      const chunks: Buffer[] = [];
      let size = 0;
      resp.on('data', (c: Buffer) => {
        if (!firstByteAt) firstByteAt = Date.now();
        size += c.length;
        chunks.push(c);
      });
      resp.on('end', () => {
        const b = encodeBody(Buffer.concat(chunks), resp.headers);
        resolve({
          ok: true,
          status: resp.statusCode ?? 0,
          statusText: resp.statusMessage || '',
          headers: toHeaderList(resp.headers),
          body: b.body,
          bodyEnc: b.enc,
          size,
          ms: Date.now() - started,
          ttfb: (firstByteAt || Date.now()) - started,
          remoteAddress: resp.socket?.remoteAddress,
        });
      });
    });
    req.setTimeout(EXEC_TIMEOUT_MS, () => req.destroy(new Error(`timeout sau ${EXEC_TIMEOUT_MS} ms`)));
    req.on('error', (e) => resolve({ ok: false, error: e.message, ms: Date.now() - started }));
    if (spec.body != null && spec.body !== '') req.write(spec.body);
    req.end();
  });
}
