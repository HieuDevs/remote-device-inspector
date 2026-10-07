import os from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ExecSpec, RelayInfo } from '../protocol/flow.js';
import { DEVICE_PORT, HTTP_PORT, MAX_JSON_BODY } from '../config.js';
import { broadcastDebug, clearDebugHistory } from '../debug/hub.js';
import { normalizeIngestFlow } from '../debug/ingest.js';
import { execRequest } from './exec.js';
import { readJson, sendJson } from './json.js';
import { handleForwardProxy, isProxyRequest } from './proxy.js';
import { serveStatic } from './static.js';

function relayInfo(): RelayInfo {
  const ips: RelayInfo['ips'] = [];
  for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) ips.push({ iface, address: a.address });
  }
  return { port: HTTP_PORT, devicePort: DEVICE_PORT, ips, primaryIp: ips[0]?.address ?? '127.0.0.1', hostname: os.hostname() };
}

export async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    }).end();
    return;
  }
  // Absolute-form URL = an app using the relay as its HTTP proxy.
  if (isProxyRequest(req)) return handleForwardProxy(req, res);

  const { pathname } = new URL(req.url || '/', 'http://x');
  const route = `${req.method} ${pathname}`;
  try {
    switch (route) {
      case 'POST /ingest':
      case 'POST /api/log': {
        const payload = await readJson<unknown>(req, MAX_JSON_BODY);
        const list = (Array.isArray(payload) ? payload : [payload]).filter((x) => x && typeof x === 'object');
        for (const item of list) broadcastDebug(normalizeIngestFlow(item as Record<string, unknown>));
        return sendJson(res, 200, { ok: true, count: list.length });
      }
      case 'POST /clear':
        clearDebugHistory();
        return sendJson(res, 200, { ok: true });
      case 'GET /api/info':
      case 'GET /info':
        return sendJson(res, 200, relayInfo());
      case 'POST /exec': {
        const spec = await readJson<ExecSpec>(req, MAX_JSON_BODY);
        return sendJson(res, 200, await execRequest(spec), { 'Cache-Control': 'no-store' });
      }
    }
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: (err as Error).message });
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
  res.writeHead(404).end('not found');
}
