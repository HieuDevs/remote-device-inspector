// Forward proxy on the HTTP port: point a phone / emulator / app's HTTP proxy at
// the relay and its traffic shows up in debug mode.
//   - plain HTTP (absolute-form request URL): full headers + bodies, streams
//     (SSE / NDJSON) pushed live while still open
//   - HTTPS (CONNECT tunnel): host, duration and byte counts only (encrypted)

import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import type { Flow } from '../protocol/flow.js';
import { broadcastDebug, nextFlowId } from '../debug/hub.js';
import { STREAM_CTYPE, encodeBody, headerOf, toHeaderList } from './body.js';

const LIVE_PUSH_MS = 300;

export const isProxyRequest = (req: IncomingMessage): boolean => /^https?:\/\//.test(req.url || '');

export function handleForwardProxy(req: IncomingMessage, res: ServerResponse): void {
  let target: URL;
  try {
    target = new URL(req.url!);
  } catch {
    res.writeHead(400).end('Bad proxy URL');
    return;
  }

  const id = nextFlowId('proxy-http');
  const started = Date.now();
  const isHttps = target.protocol === 'https:';
  const chunks: Buffer[] = [];
  let reqBytes = 0;

  req.on('data', (c: Buffer) => {
    chunks.push(c);
    reqBytes += c.length;
  });

  req.on('end', () => {
    const reqBuf = Buffer.concat(chunks);
    const reqBody = encodeBody(reqBuf, req.headers);
    const base: Flow = {
      id,
      proto: 'http',
      scheme: isHttps ? 'https' : 'http',
      host: target.hostname,
      path: target.pathname + target.search,
      url: target.href,
      method: req.method,
      reqHeaders: toHeaderList(req.headers),
      reqBody: reqBody.body,
      reqBodyEnc: reqBody.enc,
      up: reqBytes,
      t: started,
      app: 'Proxy',
    };
    broadcastDebug({ ...base, ev: 'open' });

    const headers: http.OutgoingHttpHeaders = { ...req.headers, host: target.host };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];

    const upstream = (isHttps ? https : http).request(target, {
      method: req.method,
      headers,
      rejectUnauthorized: false,
    }, (resp) => {
      const respChunks: Buffer[] = [];
      let respBytes = 0;
      const respHeaders = toHeaderList(resp.headers);
      const streaming = STREAM_CTYPE.test(headerOf(resp.headers, 'content-type'));
      let lastPush = 0;
      let pushTimer: NodeJS.Timeout | null = null;

      const txn = (done: boolean): Flow => {
        const b = encodeBody(Buffer.concat(respChunks), resp.headers);
        return {
          ...base,
          ev: 'txn',
          status: resp.statusCode,
          respHeaders,
          ctype: headerOf(resp.headers, 'content-type') || undefined,
          respBody: b.body,
          respBodyEnc: b.enc,
          down: respBytes,
          ms: Date.now() - started,
          streaming: !done,
        };
      };
      const pushLive = () => {
        pushTimer = null;
        lastPush = Date.now();
        broadcastDebug(txn(false), { live: true });
      };

      res.writeHead(resp.statusCode ?? 502, resp.headers);
      resp.on('data', (c: Buffer) => {
        respChunks.push(c);
        respBytes += c.length;
        res.write(c);
        // Streams are pushed to the viewer while open, throttled, so events
        // show up as they arrive.
        if (streaming && !pushTimer) pushTimer = setTimeout(pushLive, Math.max(0, LIVE_PUSH_MS - (Date.now() - lastPush)));
      });
      resp.on('end', () => {
        res.end();
        if (pushTimer) clearTimeout(pushTimer);
        broadcastDebug(txn(true));
      });
    });

    upstream.on('error', (err) => {
      if (!res.headersSent) res.writeHead(502);
      res.end('Bad Gateway: ' + err.message);
      broadcastDebug({ ...base, ev: 'txn', status: 502, respBody: err.message, ms: Date.now() - started });
    });

    if (reqBuf.length > 0) upstream.write(reqBuf);
    upstream.end();
  });
}

/** HTTPS through the proxy: an opaque tunnel, recorded as one CONNECT flow. */
export function handleConnect(req: IncomingMessage, clientSocket: Duplex, head: Buffer): void {
  const [host = '', portStr] = (req.url || '').split(':');
  const port = Number(portStr) || 443;
  const id = nextFlowId('proxy-tls');
  const started = Date.now();
  const base: Flow = {
    id,
    proto: 'https',
    scheme: 'https',
    host,
    path: '/',
    url: `https://${host}:${port}/`,
    method: 'CONNECT',
    t: started,
    app: 'Proxy',
  };
  broadcastDebug({ ...base, ev: 'open', up: 0, down: 0 });

  const serverSocket = net.connect(port, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head?.length) serverSocket.write(head);

    let up = 0;
    let down = 0;
    clientSocket.on('data', (d: Buffer) => { up += d.length; });
    serverSocket.on('data', (d: Buffer) => { down += d.length; });
    clientSocket.pipe(serverSocket);
    serverSocket.pipe(clientSocket);

    serverSocket.on('close', () => {
      broadcastDebug({ ...base, ev: 'txn', status: 200, ms: Date.now() - started, up, down });
    });
    clientSocket.on('error', () => {});
  });

  serverSocket.on('error', (err) => {
    try {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      clientSocket.end();
    } catch {}
    broadcastDebug({ ...base, ev: 'txn', status: 502, ms: Date.now() - started, respBody: err.message });
  });
}
