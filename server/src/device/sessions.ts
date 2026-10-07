// Device sessions: one per connected agent, identified by a 9-digit code that
// viewers type in. The relay never decodes video: it forwards H.264 packets
// device → viewers and control JSON viewers → device.

import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import type { DeviceInfo, ViewerMessage } from '../protocol/flow.js';
import { log } from '../log.js';
import { FLAG_CONFIG, FLAG_KEY, FrameParser, T, encodeFrame } from './protocol.js';

const VIEWER_BUFFER_LIMIT = 2 * 1024 * 1024; // drop delta frames above this
const SESSION_GRACE_MS = 10 * 60 * 1000; // keep code alive for reconnects

/** What a device link needs: raw TCP sockets have these, the WS path wraps them. */
export interface DeviceTransport {
  write(data: Buffer): void;
  destroy(): void;
}

export interface Session {
  code: string;
  deviceId: string;
  transport: DeviceTransport | null;
  viewers: Set<WebSocket>;
  info: DeviceInfo;
  control: boolean;
  meta: ViewerMessage | null;
  /** last SPS/PPS packet, replayed to late joiners */
  config: Buffer | null;
  expireTimer?: NodeJS.Timeout;
}

/** code → session */
const sessions = new Map<string, Session>();
/** deviceId → code, so a reconnecting device keeps the same code */
const codeByDevice = new Map<string, string>();
/** viewers that must wait for the next keyframe (decoder cannot resume mid-GOP) */
const needKey = new WeakSet<WebSocket>();

export const findSession = (code: string): Session | undefined => sessions.get(code);

function newCode(): string {
  for (;;) {
    // 9 digits: 10^9 space, combined with per-IP rate limiting on joins.
    const code = String(crypto.randomInt(100_000_000, 1_000_000_000));
    if (!sessions.has(code)) return code;
  }
}

export function sendDevice(session: Session, type: number, obj?: unknown): void {
  if (!session.transport) return;
  const payload = obj === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(obj));
  session.transport.write(encodeFrame(type, payload));
}

function broadcast(session: Session, msg: ViewerMessage): void {
  const text = JSON.stringify(msg);
  for (const ws of session.viewers) ws.send(text);
}

export function statusOf(session: Session): ViewerMessage {
  return { type: 'status', online: !!session.transport, control: session.control, info: session.info };
}

function notifyViewerCount(session: Session): void {
  sendDevice(session, T.VIEWERS, { count: session.viewers.size });
}

function closeSession(session: Session, reason: string): void {
  sessions.delete(session.code);
  if (codeByDevice.get(session.deviceId) === session.code) codeByDevice.delete(session.deviceId);
  for (const ws of session.viewers) ws.close(4410, reason);
  log(`session ${session.code} closed: ${reason}`);
}

// Per-viewer backpressure: a slow viewer must not grow memory or add latency.
// While its socket is congested we drop delta frames, then resume at the next
// keyframe.
function sendVideo(session: Session, ws: WebSocket, payload: Buffer, flags: number): void {
  const isKeyOrConfig = (flags & (FLAG_KEY | FLAG_CONFIG)) !== 0;
  if (needKey.has(ws) && !isKeyOrConfig) return;
  if (ws.bufferedAmount > VIEWER_BUFFER_LIMIT && !isKeyOrConfig) {
    if (!needKey.has(ws)) {
      needKey.add(ws);
      sendDevice(session, T.KEYFRAME);
    }
    return;
  }
  if (flags & FLAG_KEY) needKey.delete(ws);
  ws.send(payload);
}

/**
 * One device link (raw TCP or WebSocket). Feeds the shared frame parser and
 * binds the link to a session on HELLO.
 */
export class DeviceConnection {
  session: Session | null = null;
  private readonly parser = new FrameParser((type, payload) => this.onFrame(type, payload));

  constructor(readonly transport: DeviceTransport) {}

  feed(chunk: Buffer): void {
    this.parser.feed(chunk);
  }

  /** The transport went away. Keep the session (and its viewers) alive for a
   *  grace period so a reconnecting device — common on mobile — keeps its code. */
  disconnected(): void {
    const session = this.session;
    if (!session || session.transport !== this.transport) return;
    session.transport = null;
    broadcast(session, statusOf(session));
    session.expireTimer = setTimeout(() => closeSession(session, 'device gone'), SESSION_GRACE_MS);
    log(`device for ${session.code} offline`);
  }

  private onFrame(type: number, payload: Buffer): void {
    if (type === T.HELLO) return this.onHello(payload);

    const session = this.session;
    if (!session) throw new Error('frame before HELLO');

    switch (type) {
      case T.VIDEO: {
        if (payload.length < 9) return;
        const flags = payload[0];
        if (flags & FLAG_CONFIG) session.config = payload;
        for (const ws of session.viewers) sendVideo(session, ws, payload, flags);
        break;
      }
      case T.META: {
        const meta: ViewerMessage = { type: 'meta', ...JSON.parse(payload.toString('utf8')) };
        session.meta = meta;
        broadcast(session, meta);
        break;
      }
      case T.APILOG:
        broadcast(session, { type: 'api', flow: JSON.parse(payload.toString('utf8')) });
        break;
      case T.HEARTBEAT: {
        const control = !!JSON.parse(payload.toString('utf8')).control;
        if (control !== session.control) {
          session.control = control;
          broadcast(session, statusOf(session));
        }
        break;
      }
      default:
        log(`unknown device frame 0x${type.toString(16)}`);
    }
  }

  private onHello(payload: Buffer): void {
    const hello = JSON.parse(payload.toString('utf8'));
    const deviceId = String(hello.deviceId || '').slice(0, 64);
    if (!deviceId) throw new Error('missing deviceId');

    let code = codeByDevice.get(deviceId);
    let session = code ? sessions.get(code) : undefined;
    if (session) {
      // Device reconnected: replace its transport, keep the viewers.
      if (session.transport && session.transport !== this.transport) session.transport.destroy();
      clearTimeout(session.expireTimer);
    } else {
      code = newCode();
      session = {
        code,
        deviceId,
        transport: null,
        viewers: new Set(),
        info: { model: '', sdk: 0 },
        control: false,
        meta: null,
        config: null,
      };
      sessions.set(code, session);
      codeByDevice.set(deviceId, code);
    }
    session.transport = this.transport;
    session.info = { model: String(hello.model || '').slice(0, 64), sdk: hello.sdk | 0 };
    session.control = !!hello.control;
    this.session = session;

    sendDevice(session, T.SESSION, { code: session.code });
    notifyViewerCount(session);
    broadcast(session, statusOf(session));
    log(`device ${session.info.model} online, code ${session.code}`);
  }
}

/** A viewer joined: send current state and ask the device for a fresh keyframe. */
export function addViewer(session: Session, ws: WebSocket): void {
  session.viewers.add(ws);
  ws.send(JSON.stringify(statusOf(session)));
  if (session.meta) ws.send(JSON.stringify(session.meta));
  if (session.config) ws.send(session.config);
  needKey.add(ws);
  notifyViewerCount(session);
  sendDevice(session, T.KEYFRAME);
}

export function removeViewer(session: Session, ws: WebSocket): void {
  session.viewers.delete(ws);
  notifyViewerCount(session);
}
