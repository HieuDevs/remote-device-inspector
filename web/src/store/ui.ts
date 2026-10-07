// Transient UI state: modals, the row context menu and the cURL runner.

import { create } from 'zustand';
import type { ExecResult, Flow } from '@proto/flow';
import { type ParsedCurl, parseCurl } from '../lib/curl';
import { byteLen } from '../lib/format';
import { headerVal } from '../lib/flow';
import { enqueueFlow, getModeData, useNet } from './net';

interface ExecState {
  parsed: ParsedCurl;
  text: string;
  /** null while running */
  result: ExecResult | null;
}

interface UiState {
  curlOpen: boolean;
  curlText: string;
  guideOpen: boolean;
  exec: ExecState | null;
  menu: { x: number; y: number; id: string } | null;

  openCurl(text?: string): void;
  closeCurl(): void;
  setCurlText(text: string): void;
  setGuideOpen(open: boolean): void;
  closeExec(): void;
  openMenu(x: number, y: number, id: string): void;
  closeMenu(): void;
  /** Parse only: add a reference row and filter the list to its path. */
  importCurl(text: string): void;
  /** Run through the relay (/exec), show the result, add it as a row. */
  runCurl(text: string): Promise<void>;
}

let importSeq = 0;

// The row for a pasted / run cURL. When run, the response is attached so the
// row shows status, size and time and its body is searchable.
function addCurlRow(p: ParsedCurl, resp: ExecResult | null): string {
  const id = `curl-${++importSeq}`;
  const rec: Flow = {
    id,
    ev: 'txn',
    imported: true,
    proto: 'tcp',
    scheme: p.scheme,
    host: p.host,
    path: p.path,
    url: p.url,
    method: p.method,
    reqHeaders: p.reqHeaders,
    reqBody: p.reqBody ?? undefined,
    up: byteLen(p.reqBody),
    ctype: headerVal(p.reqHeaders, 'content-type'),
    dstPort: p.scheme === 'http' ? 80 : 443,
    app: 'cURL',
    t: Date.now(),
    down: 0,
    ms: 0,
  };
  if (resp?.ok) {
    Object.assign(rec, {
      status: resp.status,
      statusText: resp.statusText,
      respHeaders: resp.headers,
      respBody: resp.body,
      respBodyEnc: resp.bodyEnc,
      down: resp.size || byteLen(resp.body),
      ms: resp.ms,
      ttfb: resp.ttfb,
      dstIp: resp.remoteAddress || '',
      ctype: headerVal(resp.headers, 'content-type') || rec.ctype,
    });
  }
  enqueueFlow(rec, useNet.getState().mode);
  return id;
}

// Filter the list to the request's path so matching captured traffic surfaces.
function filterToPath(p: ParsedCurl, id: string): void {
  const net = useNet.getState();
  net.setFilter({ text: p.path.split('?')[0] });
  // The row is added with the next batch; select it once it exists.
  setTimeout(() => {
    if (getModeData().flows[id]) net.select(id);
  }, 50);
}

export const useUi = create<UiState>()((set) => ({
  curlOpen: false,
  curlText: '',
  guideOpen: false,
  exec: null,
  menu: null,

  openCurl: (text) => set((s) => ({ curlOpen: true, curlText: text ?? s.curlText })),
  closeCurl: () => set({ curlOpen: false }),
  setCurlText: (curlText) => set({ curlText }),
  setGuideOpen: (guideOpen) => set({ guideOpen }),
  closeExec: () => set({ exec: null }),
  openMenu: (x, y, id) => set({ menu: { x, y, id } }),
  closeMenu: () => set({ menu: null }),

  importCurl: (text) => {
    const p = parseCurl(text);
    filterToPath(p, addCurlRow(p, null));
  },

  runCurl: async (text) => {
    const parsed = parseCurl(text); // throws → shown by the caller
    set({ exec: { parsed, text, result: null } });
    let result: ExecResult;
    try {
      const r = await fetch('/exec', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: parsed.method, url: parsed.url, headers: parsed.reqHeaders, body: parsed.reqBody }),
      });
      result = await r.json();
    } catch (e) {
      result = { ok: false, error: "Can't reach the relay: " + (e as Error).message };
    }
    set((s) => (s.exec?.text === text ? { exec: { parsed, text, result } } : {}));
    if (result.ok) filterToPath(parsed, addCurlRow(parsed, result));
  },
}));
