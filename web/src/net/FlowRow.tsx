import { type MouseEvent, memo } from 'react';
import type { Flow } from '@proto/flow';
import { bytesText } from '../lib/format';
import { isLive, methodOf, nameOf, nameParts, schemeOf, typeLabel, typeOf } from '../lib/flow';

interface Props {
  r: Flow;
  selected: boolean;
  /** capture window for the waterfall bar */
  firstTs: number;
  span: number;
  onSelect(id: string): void;
  onMenu(e: MouseEvent, id: string): void;
  onPin(id: string): void;
}

function StatusPill({ r }: { r: Flow }) {
  if (r.status) return <span className={`pill st-${String(r.status)[0]}`}>{r.status}</span>;
  if (r.ev === 'close' || r.proto === 'dns') {
    return r.scheme === 'https' ? <span className="pill st-tls">TLS</span> : <span className="pill st-done">xong</span>;
  }
  return <span className="pill st-pending">live</span>;
}

export const FlowRow = memo(function FlowRow({ r, selected, firstTs, span, onSelect, onMenu, onPin }: Props) {
  const np = nameParts(r);
  const mark = r.imported ? 'imported' : r.scheme === 'https' ? 'lock' : r.scheme === 'http' ? 'plain' : '';
  const m = methodOf(r);
  const start = (((r.t ?? firstTs) - (firstTs || r.t || 0)) / span) * 100;
  const width = Math.max(1.5, ((r.ms || 0) / span) * 100);
  const cls = [isLive(r) && 'live', selected && 'sel', r.imported && 'imported-row', r.pinned && 'pinned'].filter(Boolean).join(' ');

  return (
    <tr className={cls} onClick={() => onSelect(r.id)} onContextMenu={(e) => onMenu(e, r.id)}>
      <td className="name" title={nameOf(r)}>
        <button
          type="button"
          className={`star-btn${r.pinned ? ' on' : ''}`}
          title={r.pinned ? 'Unpin' : 'Pin'}
          onClick={(e) => { e.stopPropagation(); onPin(r.id); }}
        >
          {r.pinned ? '★' : '☆'}
        </button>
        <span className={`nm ${mark} mono`}>
          {np.host && <span className="host">{np.host}</span>}
          {np.path && <span className="path">{np.path}</span>}
        </span>
      </td>
      <td className="c-status"><StatusPill r={r} /></td>
      <td className="c-method"><span className={`m m-${m}`}>{m}</span></td>
      <td className="c-type" title={typeOf(r)}>{typeLabel(r)}</td>
      <td className="c-size">{bytesText((r.up || 0) + (r.down || 0))}</td>
      <td className="c-time">
        {r.ms != null ? (
          <span className={`dur ${r.ms > 2000 ? 'vslow' : r.ms > 800 ? 'slow' : ''}`}>
            <span className="n">{r.ms} ms</span>
            <span className="track"><i style={{ width: `${Math.min(100, Math.max(4, (r.ms / 2000) * 100))}%` }} /></span>
          </span>
        ) : (
          <span className="dur"><span className="n" style={{ color: 'var(--muted)' }}>…</span></span>
        )}
      </td>
      <td>
        <div className={`wf ${schemeOf(r)}`}>
          <i style={{ left: `${start}%`, width: `${Math.min(width, 100 - start)}%` }} />
        </div>
      </td>
    </tr>
  );
});
