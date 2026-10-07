import type { IncomingMessage, ServerResponse } from 'node:http';

export function readJson<T = unknown>(req: IncomingMessage, cap: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let len = 0;
    let done = false;
    const fail = (err: Error) => { if (!done) { done = true; reject(err); } };
    req.on('data', (c: Buffer) => {
      if (done) return;
      len += c.length;
      if (len > cap) { fail(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(e as Error); }
    });
    req.on('error', fail);
  });
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...headers }).end(JSON.stringify(body));
}
