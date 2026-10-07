// Serves the built dashboard (web/dist). Hashed assets are cached forever,
// index.html never (so a rebuild shows up on reload).

import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WEB_DIST } from '../config.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

export function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  let file = path.resolve(WEB_DIST, rel || 'index.html');
  // Never serve outside the dist folder.
  if (file !== WEB_DIST && !file.startsWith(WEB_DIST + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(file, (err, st) => {
    // Unknown paths fall back to the app shell.
    if (err || !st.isFile()) file = path.join(WEB_DIST, 'index.html');
    const isShell = file.endsWith('index.html');
    fs.readFile(file, (err2, data) => {
      if (err2) {
        res.writeHead(isShell ? 503 : 404, { 'Content-Type': 'text/plain; charset=utf-8' })
          .end(isShell ? 'Dashboard is not built. Run: bun run build' : 'not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': isShell ? 'no-store' : 'public, max-age=31536000, immutable',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
}
