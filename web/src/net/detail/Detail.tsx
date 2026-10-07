import { Copy, Pencil, RotateCw, Star, X } from 'lucide-react';
import { type CSSProperties, type ReactNode, useState } from 'react';
import type { Flow } from '@proto/flow';
import { prettyBody } from '../../lib/body/json';
import { copyToClipboard } from '../../lib/clipboard';
import { curlOf } from '../../lib/curl';
import { bytesText, fmtClock } from '../../lib/format';
import { isHttp, isWs, methodOf, schemeOf, urlOf } from '../../lib/flow';
import { useLayout } from '../../store/layout';
import { useNet } from '../../store/net';
import { Menu, MenuItem } from '../Menu';
import { editAndResend, replay } from '../actions';
import { MessagePane } from './MessagePane';
import { WsMessages } from './WsMessages';

type Tab = 'general' | 'request' | 'response' | 'messages';

function General({ r }: { r: Flow }) {
  const dest = r.dstIp ? `${r.dstIp}${r.dstPort ? `:${r.dstPort}` : ''}` : '';
  const rows: [string, unknown][] = [
    ['URL', urlOf(r)],
    ['Method', methodOf(r)],
    ['Status', r.status],
    ['Started', r.t ? fmtClock(r.t) : ''],
    ['Duration', r.ms != null ? `${r.ms} ms` : 'pending…'],
    ['Sent', r.up ? bytesText(r.up) : ''],
    ['Received', r.down ? bytesText(r.down) : ''],
    ['Content-Type', r.ctype],
    ['App', r.app],
    ['IP address', dest],
    ['Protocol', schemeOf(r).toUpperCase()],
  ];
  return (
    <dl className="kv">
      {rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => (<KV key={k} k={k} v={String(v)} />))}
    </dl>
  );
}

const KV = ({ k, v }: { k: string; v: string }) => (<><dt>{k}</dt><dd className="mono">{v}</dd></>);

interface Props {
  r: Flow;
  style?: CSSProperties;
}

export function Detail({ r, style }: Props) {
  const [tab, setTab] = useState<Tab>('general');
  const msgLeftPct = useLayout((s) => s.msgLeftPct);
  const { select, togglePin } = useNet.getState();
  const ws = isWs(r);
  const current = tab === 'messages' && !ws ? 'general' : tab;
  const url = urlOf(r);
  const m = methodOf(r);
  const http = isHttp(r);
  const body = r.respBody || r.reqBody;

  const tabs: [Tab, string][] = [
    ['general', 'General'],
    ['request', 'Request'],
    ['response', 'Response'],
    ...(ws ? [['messages', 'WebSocket'] as [Tab, string]] : []),
  ];

  return (
    <div
      className="net-detail open"
      id="netDetail"
      style={{ ...style, ...(msgLeftPct ? { ['--msg-left' as string]: `${msgLeftPct}%` } : {}) }}
    >
      <div className="detail-head">
        <span className={`m m-${m}`}>{m}</span>
        {r.status ? <span className={`pill st-${String(r.status)[0]}`}>{r.status}</span> : null}
        <span className="dh-name mono" title={url}>{url}</span>
        <button type="button" className={`ibtn square${r.pinned ? ' active' : ''}`} title={r.pinned ? 'Unpin' : 'Pin'} onClick={() => togglePin(r.id)}>
          <Star size={14} fill={r.pinned ? 'currentColor' : 'none'} />
        </button>
        {http && (
          <>
            <button type="button" className="ibtn" title="Resend this request" onClick={() => replay(r)}>
              <RotateCw size={13} /> Resend
            </button>
            <button type="button" className="ibtn square" title="Edit and resend" onClick={() => editAndResend(r)}>
              <Pencil size={13} />
            </button>
          </>
        )}
        <Menu label={<><Copy size={13} /> Copy</>} title="Copy" className="ibtn">
          {(close) => (
            <>
              <CopyItem text={url} close={close}>URL</CopyItem>
              {http && r.method && <CopyItem text={curlOf(r)} close={close}>cURL command</CopyItem>}
              {body && <CopyItem text={prettyBody(body)} close={close}>{r.respBody ? 'Response body' : 'Request body'}</CopyItem>}
            </>
          )}
        </Menu>
        <button type="button" className="ibtn square ghost" title="Close (Esc)" onClick={() => select(null)}>
          <X size={15} />
        </button>
      </div>
      <div className="tabs">
        {tabs.map(([t, label]) => (
          <span key={t} className={`tab${t === current ? ' on' : ''}`} onClick={() => setTab(t)}>{label}</span>
        ))}
      </div>
      {current === 'general' && <div className="tabpane on"><General r={r} /></div>}
      {current === 'request' && <div className="tabpane msg-pane on"><MessagePane key={r.id} r={r} side="req" /></div>}
      {current === 'response' && <div className="tabpane msg-pane on"><MessagePane key={r.id} r={r} side="resp" /></div>}
      {current === 'messages' && <div className="tabpane on"><WsMessages r={r} /></div>}
    </div>
  );
}

function CopyItem({ text, close, children }: { text: string; close(): void; children: ReactNode }) {
  return (
    <MenuItem icon={<Copy size={14} />} onClick={() => { void copyToClipboard(text); close(); }}>
      {children}
    </MenuItem>
  );
}
