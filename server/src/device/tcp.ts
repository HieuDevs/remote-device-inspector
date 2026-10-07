import net from 'node:net';
import { log } from '../log.js';
import { DeviceConnection } from './sessions.js';

/** Raw TCP listener for agents on the same network (or via `adb reverse`). */
export function createDeviceTcpServer(): net.Server {
  return net.createServer((socket) => {
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 10_000);
    socket.setTimeout(30_000); // device heartbeats every 5s

    const conn = new DeviceConnection(socket);
    socket.on('data', (chunk: Buffer) => {
      try {
        conn.feed(chunk);
      } catch (err) {
        log(`device protocol error: ${(err as Error).message}`);
        socket.destroy();
      }
    });
    socket.on('timeout', () => socket.destroy());
    socket.on('error', () => {});
    socket.on('close', () => conn.disconnected());
  });
}
