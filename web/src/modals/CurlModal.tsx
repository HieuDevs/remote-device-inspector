import { useEffect, useRef, useState } from 'react';
import { parseCurl } from '../lib/curl';
import { useUi } from '../store/ui';
import { Modal } from './Modal';

const PLACEHOLDER = `curl 'https://api.example.com/v1/orders' \\
  -X POST \\
  -H 'content-type: application/json' \\
  --data-raw '{"sku":"A1"}'`;

export function CurlModal() {
  const { curlText, setCurlText, closeCurl, importCurl, runCurl } = useUi();
  const [error, setError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => input.current?.focus(), []);

  const attempt = (fn: () => void) => {
    try {
      fn();
      closeCurl();
    } catch (e) {
      setError((e as Error).message || String(e));
    }
  };
  const parseOnly = () => attempt(() => importCurl(curlText));
  // Validate before closing, so a bad command keeps the popup open with the error.
  const run = () => attempt(() => { parseCurl(curlText); void runCurl(curlText); });

  return (
    <Modal id="curl" title={<strong>cURL command</strong>} onClose={closeCurl}>
      <div className="curl-input-box">
        <textarea
          id="curlInput"
          ref={input}
          spellCheck={false}
          placeholder={PLACEHOLDER}
          value={curlText}
          onChange={(e) => { setCurlText(e.target.value); setError(''); }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); }
          }}
        />
      </div>
      <div className="curl-error">{error}</div>
      <div className="modal-actions">
        <button className="ibtn" title="Don't send: add it to the list to inspect and compare" onClick={parseOnly}>Import</button>
        <button className="ibtn primary" title="Send through the relay (⌘/Ctrl + Enter)" onClick={run}>Run</button>
      </div>
    </Modal>
  );
}
