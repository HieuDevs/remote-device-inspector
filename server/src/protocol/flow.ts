// Wire types shared by the relay and the web dashboard (type-only: the web app
// imports these with `import type`, nothing here may have runtime code).

export type Header = [name: string, value: string];

/** 'base64' marks a binary body (image, file, protobuf…); absent = UTF-8 text. */
export type BodyEncoding = 'base64';

/** One message of a WebSocket conversation. */
export interface WsMessage {
  dir: 'send' | 'recv' | 'up' | 'down' | string;
  data: unknown;
  t?: number;
}

/**
 * A network flow as it travels to the viewer. Updates for the same `id` are
 * merged field by field, so most fields are optional:
 *   open   – connection seen (device VPN / proxy)
 *   resp   – response line parsed (device VPN, plain HTTP)
 *   txn    – full transaction with headers + bodies (ingest, proxy, bridge)
 *   close  – connection finished (byte counts)
 *   capture– capture switched on/off (`on`), not a row
 */
export interface Flow {
  id: string;
  ev?: 'open' | 'resp' | 'txn' | 'close' | 'capture' | 'error' | string;
  on?: boolean;

  proto?: string;
  scheme?: string;
  host?: string;
  path?: string;
  url?: string;
  method?: string;
  dstIp?: string;
  dstPort?: number;
  app?: string;

  status?: number;
  statusText?: string;
  ctype?: string;

  /** start time (epoch ms), duration and time-to-first-byte (ms) */
  t?: number;
  ms?: number;
  ttfb?: number;
  /** bytes sent / received */
  up?: number;
  down?: number;

  reqHeaders?: Header[];
  reqBody?: string;
  reqBodyEnc?: BodyEncoding;
  respHeaders?: Header[];
  respBody?: string;
  respBodyEnc?: BodyEncoding;

  messages?: WsMessage[];
  /** true while a streamed response (SSE / NDJSON) is still open */
  streaming?: boolean;

  // Viewer-only fields (never sent by the relay).
  imported?: boolean;
  pinned?: boolean;
}

export interface DeviceInfo {
  model: string;
  sdk: number;
}

/** Messages the relay sends to a viewer over /ws (text frames). */
export type ViewerMessage =
  | { type: 'status'; online: boolean; control: boolean; info?: DeviceInfo; debug?: boolean }
  | { type: 'meta'; width?: number; height?: number }
  | { type: 'api'; flow: Flow };

/** Control messages a viewer sends to the device (via the relay). */
export type ControlMessage =
  | { t: 'down' | 'move' | 'up'; x: number; y: number }
  | { t: 'key'; k: string }
  | { t: 'type'; s: string }
  | { t: 'keyframe' }
  | { t: 'gesture'; [k: string]: unknown };

/** POST /exec request and response. */
export interface ExecSpec {
  method: string;
  url: string;
  headers: Header[];
  body?: string | null;
}

export type ExecResult =
  | {
      ok: true;
      status: number;
      statusText: string;
      headers: Header[];
      body: string;
      bodyEnc?: BodyEncoding;
      size: number;
      ms: number;
      ttfb: number;
      remoteAddress?: string;
    }
  | { ok: false; error: string; ms?: number };

/** GET /api/info */
export interface RelayInfo {
  port: number;
  devicePort: number;
  ips: { iface: string; address: string }[];
  primaryIp: string;
  hostname: string;
}
