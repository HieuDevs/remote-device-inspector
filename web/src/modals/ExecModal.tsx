// Result of a cURL run through the relay: status, timing, response body and
// headers, and the request that was sent.

import { useState } from 'react';
import { BodyViewer } from '../body/BodyViewer';
import { bytesText } from '../lib/format';
import { headerVal } from '../lib/flow';
import { Headers } from '../net/detail/MessagePane';
import { useUi } from '../store/ui';
import { Modal } from './Modal';

type Tab = 'body' | 'headers' | 'req';

export function ExecModal() {
  const exec = useUi((s) => s.exec)!;
  const { closeExec, runCurl } = useUi.getState();
  const [tab, setTab] = useState<Tab>('body');
  const { parsed: p, result: r } = exec;

  const title = (
    <>
      <span className={`m m-${p.method}`}>{p.method}</span>
      <span>
        {!r ? <span className="pill st-pending">running</span>
          : r.ok ? <span className={`pill st-${String(r.status)[0]}`}>{r.status}{r.statusText ? ` ${r.statusText}` : ''}</span>
          : <span className="pill st-5">Error</span>}
      </span>
      <strong id="execTitle" className="mono" title={p.url}>{p.url}</strong>
    </>
  );

  return (
    <Modal
      id="exec"
      className="exec-card"
      title={title}
      actions={<button className="ibtn" title="Run again" onClick={() => void runCurl(exec.text)}>Run again</button>}
      onClose={closeExec}
    >
      <div className="exec-meta">
        {r?.ok && (
          <>
            <span><b>{r.ms}</b> ms</span>
            <span>TTFB <b>{r.ttfb}</b> ms</span>
            <span><b>{bytesText(r.size)}</b></span>
            {r.remoteAddress && <span>IP {r.remoteAddress}</span>}
          </>
        )}
        {r && !r.ok && r.ms != null && <span><b>{r.ms}</b> ms</span>}
      </div>
      <div className="tabs">
        {([['body', 'Response'], ['headers', 'Headers'], ['req', 'Request']] as [Tab, string][]).map(([t, label]) => (
          <span key={t} className={`tab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>{label}</span>
        ))}
      </div>
      {tab === 'body' && (
        <div className="tabpane on">
          {!r ? <div className="running-note">Sending…</div>
            : !r.ok ? <div className="running-note" style={{ color: 'var(--err)' }}>{r.error || 'Failed'}</div>
            : <BodyViewer key={exec.text + r.ms} src={{ raw: r.body, enc: r.bodyEnc, ctype: headerVal(r.headers, 'content-type') }} title="Body" name="response" />}
        </div>
      )}
      {tab === 'headers' && (
        <div className="tabpane on">
          {r?.ok && <Headers headers={r.headers} />}
        </div>
      )}
      {tab === 'req' && (
        <div className="tabpane on">
          <div className="sec-title">Request</div>
          <pre className="body">{p.method} {p.url}</pre>
          {p.reqHeaders.length > 0 && <Headers headers={p.reqHeaders} />}
          {p.reqBody && <BodyViewer src={{ raw: p.reqBody, ctype: headerVal(p.reqHeaders, 'content-type') }} title="Body" name="request" />}
        </div>
      )}
    </Modal>
  );
}
