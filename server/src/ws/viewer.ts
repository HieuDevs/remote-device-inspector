// Browser viewers on /ws:
//   ?mode=debug  standalone API inspector (no device, no code)
//   ?code=…      a device session: video + device API flows, control back

import type { IncomingMessage } from 'node:http';
import { WebSocketServer } from 'ws';
import { log } from '../log.js';
import { T } from '../device/protocol.js';
import { addViewer, findSession, removeViewer, sendDevice } from '../device/sessions.js';
import { addDebugViewer, removeDebugViewer } from '../debug/hub.js';

const MAX_CONTROL = 4096;
const CONTROL_TYPES = new Set(['down', 'move', 'up', 'gesture', 'key', 'type', 'keyframe']);

// Brute-force guard on session codes: N wrong codes per IP per window.
const FAIL_LIMIT = 20;
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const failures = new Map<string, { count: number; resetAt: number }>();

function isBlocked(ip: string): boolean {
  const f = failures.get(ip);
  return !!f && Date.now() <= f.resetAt && f.count >= FAIL_LIMIT;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const f = failures.get(ip);
  if (!f || now > f.resetAt) failures.set(ip, { count: 1, resetAt: now + FAIL_WINDOW_MS });
  else f.count++;
}

export function createViewerWss(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CONTROL });

  wss.on('connection', (ws, req: IncomingMessage) => {
    const ip = req.socket.remoteAddress || '';
    const params = new URL(req.url || '/', 'http://x').searchParams;
    const code = params.get('code') || '';

    if (params.get('mode') === 'debug' || code === 'debug') {
      log(`debug viewer joined from ${ip} (${addDebugViewer(ws)} active)`);
      ws.on('close', () => log(`debug viewer left from ${ip} (${removeDebugViewer(ws)} active)`));
      ws.on('error', () => {});
      return;
    }

    if (isBlocked(ip)) return ws.close(4429, 'too many attempts');
    const session = findSession(code);
    if (!session) {
      recordFailure(ip);
      return ws.close(4404, 'unknown code');
    }

    addViewer(session, ws);
    log(`viewer ${ip} joined ${code} (${session.viewers.size})`);

    ws.on('message', (data, isBinary) => {
      const buf = data as Buffer;
      if (isBinary || buf.length > MAX_CONTROL) return;
      let msg: { t?: string } | null;
      try { msg = JSON.parse(buf.toString('utf8')); } catch { return; }
      if (!msg || !CONTROL_TYPES.has(String(msg.t))) return;
      sendDevice(session, T.CONTROL, msg);
    });
    ws.on('close', () => {
      removeViewer(session, ws);
      log(`viewer ${ip} left ${code} (${session.viewers.size})`);
    });
    ws.on('error', () => {});
  });
  return wss;
}
