// Body encoding for the viewer. Captured bodies travel as strings: text-like
// bodies (JSON, SSE, XML, form…) as UTF-8; anything else (images, protobuf,
// files) as base64 with enc 'base64' so it survives the trip and can be
// previewed / downloaded. Bodies are never cut.

import type { IncomingHttpHeaders } from 'node:http';
import zlib from 'node:zlib';
import type { BodyEncoding, Header } from '../protocol/flow.js';

const TEXT_CTYPE = /^(text\/|application\/(json|[\w.+-]*\+json|x-ndjson|ndjson|jsonl|[\w.+-]*\+xml|xml|javascript|ecmascript|x-javascript|x-www-form-urlencoded|graphql|x-yaml|yaml)|image\/svg\+xml)/i;
export const STREAM_CTYPE = /^(text\/event-stream|application\/(x-ndjson|ndjson|jsonl|stream\+json|x-json-stream))/i;

type AnyHeaders = IncomingHttpHeaders | Header[] | Record<string, unknown> | null | undefined;

/** [name, value] pairs from a Node headers object, a plain object or a list. */
export function toHeaderList(h: AnyHeaders): Header[] {
  if (Array.isArray(h)) return h.map(([k, v]) => [String(k), String(v)]);
  if (h && typeof h === 'object') {
    return Object.entries(h)
      .filter(([, v]) => v != null)
      .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]);
  }
  return [];
}

export function headerOf(headers: AnyHeaders, name: string): string {
  const n = name.toLowerCase();
  const hit = toHeaderList(headers).find(([k]) => k.toLowerCase() === n);
  return hit ? hit[1] : '';
}

// Undo Content-Encoding so the viewer sees the real payload. Falls back to the
// raw bytes when the stream is incomplete or not actually compressed.
function decodeContent(buf: Buffer, encoding: string): Buffer {
  const enc = encoding.toLowerCase().trim();
  if (!buf.length || !enc || enc === 'identity') return buf;
  try {
    if (enc.includes('br')) return zlib.brotliDecompressSync(buf);
    if (enc.includes('gzip')) return zlib.gunzipSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    if (enc.includes('deflate')) {
      try { return zlib.inflateSync(buf); } catch { return zlib.inflateRawSync(buf); }
    }
  } catch {}
  return buf;
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 2048);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  // Invalid UTF-8 turns into U+FFFD on decode.
  return buf.subarray(0, n).toString('utf8').includes('�');
}

export function encodeBody(buf: Buffer, headers: AnyHeaders): { body: string; enc?: BodyEncoding } {
  if (!buf.length) return { body: '' };
  const data = decodeContent(buf, headerOf(headers, 'content-encoding'));
  const ctype = headerOf(headers, 'content-type');
  const text = ctype ? TEXT_CTYPE.test(ctype) : !looksBinary(data);
  return text ? { body: data.toString('utf8') } : { body: data.toString('base64'), enc: 'base64' };
}
