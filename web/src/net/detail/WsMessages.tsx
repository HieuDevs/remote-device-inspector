import type { Flow } from '@proto/flow';
import { highlightJsonHtml } from '../../lib/body/highlightJson';
import { prettyBody } from '../../lib/body/json';
import { bytesText, fmtClock } from '../../lib/format';
import { CopyButton } from '../CopyButton';

export function WsMessages({ r }: { r: Flow }) {
  if (!r.messages?.length) return <div className="hint" style={{ maxWidth: 'none' }}>No messages yet</div>;
  return (
    <div className="ws-msg-list">
      {r.messages.map((m, i) => {
        const send = m.dir === 'send' || m.dir === 'up';
        const raw = typeof m.data === 'object' ? JSON.stringify(m.data) : String(m.data ?? '');
        return (
          <div key={i} className={`ws-msg ${send ? 'send' : 'recv'}`}>
            <div className="ws-msg-head">
              <span className="ws-dir">{send ? '↑ Sent' : '↓ Received'}</span>
              <span className="ws-time mono">{m.t ? fmtClock(m.t) : ''}</span>
              <span className="ws-len">{bytesText(raw.length)}</span>
              <CopyButton className="copy" text={() => prettyBody(raw)}>Copy</CopyButton>
            </div>
            <pre className="body" dangerouslySetInnerHTML={{ __html: highlightJsonHtml(raw) }} />
          </div>
        );
      })}
    </div>
  );
}
