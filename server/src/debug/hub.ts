// Standalone debug session: API flows from /ingest and the forward proxy go to
// every debug viewer, without a device or a session code.

import type { WebSocket } from 'ws';
import type { Flow, ViewerMessage } from '../protocol/flow.js';
import { MAX_DEBUG_HISTORY } from '../config.js';

const viewers = new Set<WebSocket>();
const history: Flow[] = [];
let seq = 0;

export const nextFlowId = (prefix: string): string => `${prefix}-${++seq}`;

/**
 * Send a flow to all debug viewers. `live` marks an in-progress update (a
 * stream still open): sent, but not kept in history — the final update is.
 */
export function broadcastDebug(flow: Flow, opts: { live?: boolean } = {}): void {
  if (!opts.live) {
    history.push(flow);
    if (history.length > MAX_DEBUG_HISTORY) history.shift();
  }
  const text = JSON.stringify({ type: 'api', flow } satisfies ViewerMessage);
  for (const ws of viewers) {
    try { ws.send(text); } catch {}
  }
}

export function clearDebugHistory(): void {
  history.length = 0;
}

export function addDebugViewer(ws: WebSocket): number {
  viewers.add(ws);
  const send = (msg: ViewerMessage) => ws.send(JSON.stringify(msg));
  send({ type: 'status', online: true, control: false, debug: true, info: { model: 'Debug Standalone', sdk: 0 } });
  send({ type: 'api', flow: { id: 'capture', ev: 'capture', on: true } });
  for (const flow of history) send({ type: 'api', flow });
  return viewers.size;
}

export function removeDebugViewer(ws: WebSocket): number {
  viewers.delete(ws);
  return viewers.size;
}
