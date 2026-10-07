// Decides what a body is (from Content-Type, magic numbers and content) and
// which views it gets. Nothing is cut: every view renders the whole body.

import type { BodyEncoding } from '@proto/flow';
import { byteLen } from '../format';
import { type JsonNode, tryJson } from './json';

export interface BodySource {
  raw: string | undefined | null;
  enc?: BodyEncoding;
  ctype?: string;
}

export type BodyKind =
  | 'json' | 'ndjson' | 'sse' | 'image' | 'svg' | 'html' | 'xml' | 'form'
  | 'pdf' | 'audio' | 'video' | 'binary' | 'text';

export type BodyView = 'pretty' | 'raw' | 'events' | 'lines' | 'preview' | 'hex' | 'table' | 'source';

export interface SseEvent {
  data: string[];
  comments: string[];
  event?: string;
  id?: string;
  retry?: string;
  /** last block of a stream that has not ended yet */
  partial?: boolean;
}

export interface NdLine {
  text: string;
  json: JsonNode | null;
}

export interface BodyInfo {
  kind: BodyKind;
  /** views offered, first = default */
  views: BodyView[];
  /** the body as received (base64 for binary) */
  raw: string;
  /** decoded text (text bodies, SVG, binary that turned out to be text) */
  text: string;
  /** decoded bytes (binary bodies) */
  bytes: Uint8Array | null;
  mime: string;
  size: number;
  json?: JsonNode;
  events?: SseEvent[];
  lines?: NdLine[];
  note?: string;
}

export const VIEW_LABEL: Record<BodyView, string> = {
  pretty: 'Pretty', raw: 'Raw', events: 'Events', lines: 'Lines',
  preview: 'Preview', hex: 'Hex', table: 'Table', source: 'Source',
};

export const KIND_LABEL: Record<BodyKind, string> = {
  json: 'JSON', ndjson: 'JSON stream', sse: 'Server-Sent Events', image: 'Image', svg: 'SVG',
  html: 'HTML', xml: 'XML', form: 'Form', pdf: 'PDF', audio: 'Audio', video: 'Video',
  binary: 'Binary', text: 'Text',
};

export function b64Bytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const isB64 = (s: string): boolean =>
  s.length >= 16 && s.length % 4 === 0 && /^[A-Za-z0-9+/\r\n]+={0,2}\s*$/.test(s);

// Magic numbers -> mime, for bodies sent without a (correct) Content-Type.
export function sniffMime(u8: Uint8Array): string {
  const hex = (n: number) => Array.from(u8.subarray(0, n), (b) => b.toString(16).padStart(2, '0')).join('');
  const asc = (a: number, b: number) => String.fromCharCode(...u8.subarray(a, b));
  if (hex(8) === '89504e470d0a1a0a') return 'image/png';
  if (hex(3) === 'ffd8ff') return 'image/jpeg';
  if (asc(0, 4) === 'GIF8') return 'image/gif';
  if (asc(0, 4) === 'RIFF' && asc(8, 12) === 'WEBP') return 'image/webp';
  if (asc(0, 4) === 'RIFF' && asc(8, 12) === 'WAVE') return 'audio/wav';
  if (asc(4, 8) === 'ftyp') {
    const brand = asc(8, 12);
    return /avif|avis/.test(brand) ? 'image/avif' : /heic|heix|mif1/.test(brand) ? 'image/heic' : 'video/mp4';
  }
  if (hex(2) === '424d') return 'image/bmp';
  if (hex(4) === '00000100') return 'image/x-icon';
  if (asc(0, 4) === '%PDF') return 'application/pdf';
  if (asc(0, 3) === 'ID3' || hex(2) === 'fffb') return 'audio/mpeg';
  if (asc(0, 4) === 'OggS') return 'audio/ogg';
  if (hex(4) === '1a45dfa3') return 'video/webm';
  if (hex(4) === '504b0304') return 'application/zip';
  if (hex(2) === '1f8b') return 'application/gzip';
  return '';
}

export const parseLines = (raw: string): NdLine[] =>
  raw.split(/\r?\n/).filter((l) => l.trim()).map((text) => ({ text, json: tryJson(text) }));

/** Server-Sent Events: blank-line separated blocks of `field: value` lines. */
export function parseSse(raw: string): SseEvent[] {
  const events: SseEvent[] = [];
  let cur: SseEvent | null = null;
  const flush = (partial = false) => {
    if (!cur) return;
    if (partial) cur.partial = true;
    events.push(cur);
    cur = null;
  };
  for (const line of raw.split(/\r\n|\r|\n/)) {
    if (line === '') { flush(); continue; }
    const ev: SseEvent = (cur ??= { data: [], comments: [] });
    if (line[0] === ':') { ev.comments.push(line.slice(1).trim()); continue; }
    const idx = line.indexOf(':');
    const field = idx < 0 ? line : line.slice(0, idx);
    let v = idx < 0 ? '' : line.slice(idx + 1);
    if (v[0] === ' ') v = v.slice(1);
    if (field === 'data') ev.data.push(v);
    else if (field === 'event' || field === 'id' || field === 'retry') ev[field] = v;
  }
  flush(!/\n\s*$/.test(raw));
  return events;
}

const looksLikeText = (s: string): boolean => !s.includes('�') && !/[\x00-\x08\x0e-\x1f]/.test(s.slice(0, 4096));

export function analyzeBody(src: BodySource): BodyInfo {
  const raw = String(src.raw ?? '');
  const ct = String(src.ctype || '').toLowerCase().split(';')[0].trim();
  const base: BodyInfo = { kind: 'text', views: ['raw'], raw, text: raw, bytes: null, mime: ct, size: 0 };
  const as = (kind: BodyKind, views: BodyView[], extra: Partial<BodyInfo> = {}): BodyInfo =>
    ({ ...base, kind, views, ...extra });

  let bytes: Uint8Array | null = null;
  if (src.enc === 'base64') {
    try { bytes = b64Bytes(raw); } catch {}
  } else if (/^data:[\w.+-]+\/[\w.+-]+;base64,/i.test(raw)) {
    const comma = raw.indexOf(',');
    try {
      bytes = b64Bytes(raw.slice(comma + 1));
      base.mime = raw.slice(5, comma).split(';')[0];
    } catch {}
  } else if (
    /^(image|audio|video)\/|^application\/(pdf|octet-stream|zip|gzip|protobuf|x-protobuf)/.test(ct) &&
    ct !== 'image/svg+xml' && isB64(raw.trim())
  ) {
    // Some clients post binary bodies as plain base64 without the flag.
    try { bytes = b64Bytes(raw.trim()); } catch {}
  }

  if (bytes) {
    const mime = sniffMime(bytes) || base.mime || 'application/octet-stream';
    Object.assign(base, { bytes, mime, size: bytes.length });
    if (mime === 'image/svg+xml') return as('svg', ['preview', 'source'], { text: new TextDecoder().decode(bytes) });
    if (mime.startsWith('image/')) return as('image', ['preview', 'hex']);
    if (mime === 'application/pdf') return as('pdf', ['preview', 'hex']);
    if (mime.startsWith('audio/')) return as('audio', ['preview', 'hex']);
    if (mime.startsWith('video/')) return as('video', ['preview', 'hex']);
    // Binary that is really text (wrong or missing content type).
    const txt = new TextDecoder().decode(bytes);
    if (looksLikeText(txt)) return analyzeBody({ raw: txt, ctype: src.ctype });
    return as('binary', ['hex']);
  }

  base.size = byteLen(raw);
  const head = raw.trimStart().slice(0, 256);
  if (ct === 'text/event-stream' || /^(?::[^\n]*\n)*(data|event|id|retry):/.test(head)) {
    return as('sse', ['events', 'raw'], { events: parseSse(raw) });
  }
  if (/ndjson|jsonl|stream\+json|json-seq|x-json-stream/.test(ct)) {
    return as('ndjson', ['lines', 'raw'], { lines: parseLines(raw) });
  }
  if (ct === 'image/svg+xml' || /^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(head)) return as('svg', ['preview', 'source', 'raw']);
  const json = tryJson(raw);
  if (json) return as('json', ['pretty', 'raw'], { json });
  if (/json/.test(ct) || /^[{[]/.test(head)) {
    // Several JSON documents, one per line (a stream without its content type).
    const lines = parseLines(raw);
    if (lines.length > 1 && lines.every((l) => l.json)) return as('ndjson', ['lines', 'raw'], { lines });
    if (/json/.test(ct)) return as('text', ['raw'], { note: 'Content-Type says JSON but the body is not valid JSON.' });
  }
  if (/html/.test(ct) || /^<!doctype html|^<html[\s>]/i.test(head)) return as('html', ['source', 'preview']);
  if (/xml/.test(ct) || /^<\?xml/i.test(head)) return as('xml', ['pretty', 'raw']);
  if (ct === 'application/x-www-form-urlencoded') return as('form', ['table', 'raw']);
  if (raw.includes('�') && /^(image|audio|video)\//.test(ct)) {
    return as('text', ['raw'], {
      note: `This binary body was sent as text and is corrupted. Send it with respBodyEnc: "base64" (or use the relay's proxy) to preview it.`,
    });
  }
  return base;
}
