// Request / Response tab: request line or status + headers on the left, body
// on the right, split by a draggable gutter (width shared by both tabs, saved).

import type { Flow, Header } from '@proto/flow';
import { BodyViewer } from '../../body/BodyViewer';
import { useDrag } from '../../hooks/useDrag';
import { bytesText, clamp } from '../../lib/format';
import { headerVal, headersText, methodOf } from '../../lib/flow';
import { useLayout } from '../../store/layout';
import { CopyButton } from '../CopyButton';

function fileName(r: Flow, side: 'req' | 'resp'): string {
  const last = String(r.path || '').split('?')[0].split('/').filter(Boolean).pop() || 'body';
  return side === 'req' ? `${last}.request` : last;
}

export function Headers({ headers, title = 'Headers' }: { headers: Header[] | undefined; title?: string }) {
  if (!headers?.length) return null;
  return (
    <>
      <div className="sec-title">
        {title} <span className="count">{headers.length}</span>
        <CopyButton className="copy" text={() => headersText(headers)}>Copy</CopyButton>
      </div>
      <div className="hdrs">
        <div className="h">
          {headers.map(([k, v], i) => (
            <HeaderRow key={i} k={k} v={v} />
          ))}
        </div>
      </div>
    </>
  );
}

const HeaderRow = ({ k, v }: { k: string; v: string }) => (<><dt>{k}</dt><dd>{v}</dd></>);

export function MessagePane({ r, side }: { r: Flow; side: 'req' | 'resp' }) {
  const setPct = useLayout((s) => s.setMsgLeftPct);
  const req = side === 'req';
  const headers = req ? r.reqHeaders : r.respHeaders;
  const body = req ? r.reqBody : r.respBody;
  const enc = req ? r.reqBodyEnc : r.respBodyEnc;
  const ctype = headerVal(headers, 'content-type') || (req ? '' : r.ctype || '');

  const gutter = useDrag({
    axis: 'col',
    onMove: (e) => {
      // The handle sits in the tab pane's grid; measure the pane.
      const box = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
      if (!box) return;
      const px = clamp(e.clientX - box.left, 160, box.width - 220);
      setPct(Math.round((px / box.width) * 1000) / 10);
    },
  });

  if (!headers && body == null) {
    return (
      <div className="hint msg-hint" style={{ maxWidth: 'none' }}>
        No data
      </div>
    );
  }

  const m = methodOf(r);
  return (
    <>
      <div className="msg-col msg-left">
        {req ? (
          <>
            <div className="sec-title">Request line</div>
            <div className="msg-status">
              <span className={`m m-${m}`}>{m}</span>
              <span className="mono">{r.path || '—'}</span>
            </div>
          </>
        ) : (
          <>
            <div className="sec-title">Status</div>
            <div className="msg-status">
              {r.status != null
                ? <span className={`pill st-${String(r.status)[0]}`}>{r.status}</span>
                : <span className="hint" style={{ maxWidth: 'none' }}>—</span>}
              {r.ms != null && <span className="hint" style={{ maxWidth: 'none' }}>{r.ms} ms · {bytesText(r.down)}</span>}
              {r.streaming && <span className="pill st-pending">streaming</span>}
            </div>
          </>
        )}
        <Headers headers={headers} />
      </div>
      <div
        className="msg-gutter"
        title="Drag to resize (double-click to reset)"
        {...gutter}
        onDoubleClick={() => setPct(null)}
      />
      <div className="msg-col msg-right">
        {body ? (
          <BodyViewer src={{ raw: body, enc, ctype }} title="Body" name={fileName(r, side)} follow={!!r.streaming} />
        ) : (
          <div className="hint" style={{ maxWidth: 'none' }}>No body</div>
        )}
      </div>
    </>
  );
}
