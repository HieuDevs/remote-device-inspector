// Relay server.
//
//   Android agent ──TCP / WS (framed)──▶ relay ◀──WebSocket── browser dashboard
//
// Both sides dial OUT to the relay, so neither needs a public IP or open port.
// The same HTTP port also serves the dashboard, the API ingest endpoint and a
// forward proxy for capturing app traffic.

import http from 'node:http';
import { DEVICE_PORT, HTTP_PORT, WEB_DIST } from './config.js';
import { log } from './log.js';
import { createDeviceTcpServer } from './device/tcp.js';
import { handleConnect } from './http/proxy.js';
import { handleHttp } from './http/routes.js';
import { createDeviceWss } from './ws/device.js';
import { createViewerWss } from './ws/viewer.js';

const httpServer = http.createServer((req, res) => {
  handleHttp(req, res).catch((err) => {
    log(`http error: ${(err as Error).message}`);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

// HTTPS through the forward proxy.
httpServer.on('connect', handleConnect);

// Two WebSocket endpoints share the HTTP server, routed by path:
//   /ws      browser viewer — small control messages
//   /device  agent via tunnel — framed video/control, same wire as raw TCP
const viewerWss = createViewerWss();
const deviceWss = createDeviceWss();
httpServer.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url || '/', 'http://x');
  const wss = pathname === '/ws' ? viewerWss : pathname === '/device' ? deviceWss : null;
  if (!wss) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

createDeviceTcpServer().listen(DEVICE_PORT, () => log(`device TCP listening on :${DEVICE_PORT}`));
httpServer.listen(HTTP_PORT, () => log(`dashboard + API on http://localhost:${HTTP_PORT} (static: ${WEB_DIST})`));
