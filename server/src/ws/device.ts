// Agent over WebSocket (e.g. behind Cloudflare Tunnel / any wss reverse proxy).
// The agent dials wss://host/device and speaks the exact same framed protocol
// as the raw-TCP path, so the session logic is shared.

import type { IncomingMessage } from 'node:http';
import { WebSocketServer } from 'ws';
import { log } from '../log.js';
import { MAX_FRAME } from '../device/protocol.js';
import { DeviceConnection } from '../device/sessions.js';

export function createDeviceWss(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
  wss.on('connection', (ws, req: IncomingMessage) => {
    ws.binaryType = 'nodebuffer';
    const conn = new DeviceConnection({
      write: (b) => { try { ws.send(b); } catch {} },
      destroy: () => { try { ws.close(); } catch {} },
    });
    // Keep intermediaries (and the agent's reconnect logic) from idling us out.
    const ping = setInterval(() => { try { ws.ping(); } catch {} }, 10_000);

    ws.on('message', (data, isBinary) => {
      if (!isBinary) return; // protocol is binary-only
      try {
        conn.feed(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
      } catch (err) {
        log(`device ws protocol error: ${(err as Error).message}`);
        ws.close();
      }
    });
    ws.on('close', () => { clearInterval(ping); conn.disconnected(); });
    ws.on('error', () => {});
    log(`device ws connected from ${req.socket.remoteAddress}`);
  });
  return wss;
}
