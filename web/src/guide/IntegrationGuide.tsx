// How to send an app's requests here: pick where the app runs (gives the
// ingest URL), then copy the interceptor for the app's stack. Shown as the
// empty state of the API view and in the guide popup.

import { Send } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import type { RelayInfo } from '@proto/flow';
import { CopyButton } from '../net/CopyButton';
import * as S from './snippets';

type Env = 'emu' | 'sim' | 'usb' | 'lan';
type Stack = 'flutter' | 'android' | 'ios' | 'rn' | 'proxy' | 'curl';

// /api/info is the same for every guide on the page: fetch it once.
let infoPromise: Promise<RelayInfo | null> | null = null;
function useRelayInfo(): RelayInfo | null {
  const [info, setInfo] = useState<RelayInfo | null>(null);
  useEffect(() => {
    infoPromise ??= fetch('/api/info').then((r) => r.json()).catch(() => null);
    let alive = true;
    void infoPromise.then((i) => { if (alive) setInfo(i); });
    return () => { alive = false; };
  }, []);
  return info;
}

function Code({ file, code }: { file?: string; code: string }) {
  return (
    <div className="code-wrap">
      <div className="code-head">
        <span>{file}</span>
        <CopyButton className="ibtn" text={code}>Copy</CopyButton>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: ReactNode; children: ReactNode }) {
  return (
    <section className="guide-step">
      <div className="gs-head"><span className="step-num">{n}</span>{title}</div>
      {children}
    </section>
  );
}

function TestSendButton() {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const send = () => {
    setState('sending');
    fetch('/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://api.example.com/v1/rooms?guests=2',
        method: 'GET',
        statusCode: 200,
        reqHeaders: { Accept: 'application/json' },
        resHeaders: { 'Content-Type': 'application/json; charset=utf-8' },
        resBody: JSON.stringify({ rooms: [{ id: 101, type: 'Deluxe', price: 1250000 }] }),
        durationMs: 64,
        app: 'Sample request',
      }),
    })
      .then((r) => setState(r.ok ? 'done' : 'error'))
      .catch(() => setState('error'))
      .finally(() => setTimeout(() => setState('idle'), 2000));
  };
  const label = { idle: 'Send test', sending: 'Sending…', done: 'Received ✓', error: 'Failed, retry' }[state];
  return (
    <button type="button" className={`ibtn primary${state === 'done' ? ' done' : ''}`} disabled={state === 'sending'} onClick={send}>
      <Send size={13} /> {label}
    </button>
  );
}

const STACKS: [Stack, string][] = [
  ['flutter', 'Flutter'],
  ['android', 'Android'],
  ['ios', 'iOS'],
  ['rn', 'React Native'],
  ['proxy', 'Proxy (no code)'],
  ['curl', 'cURL'],
];

export function IntegrationGuide() {
  const info = useRelayInfo();
  const [env, setEnv] = useState<Env>('emu');
  const [stack, setStack] = useState<Stack>('flutter');

  const port = String(info?.port ?? (location.port || 80));
  const lanIp = info?.primaryIp || location.hostname;
  const host = { emu: '10.0.2.2', sim: '127.0.0.1', usb: '127.0.0.1', lan: lanIp }[env];
  const url = `http://${host}:${port}/ingest`;
  const adb = `adb reverse tcp:${port} tcp:${port}`;

  const envs: [Env, string][] = [
    ['emu', 'Android emulator'],
    ['sim', 'iOS simulator'],
    ['usb', 'Phone over USB'],
    ['lan', 'Phone over Wi-Fi'],
  ];

  return (
    <div className="guide">
      <Step n={1} title="Where does your app run?">
        <div className="seg">
          {envs.map(([id, label]) => (
            <button key={id} type="button" className={env === id ? 'on' : ''} onClick={() => setEnv(id)}>{label}</button>
          ))}
        </div>
        <div className="endpoint">
          <code>{url}</code>
          <CopyButton className="ibtn" text={url}>Copy</CopyButton>
          <TestSendButton />
        </div>
        {env === 'usb' && (
          <div className="endpoint-note">
            Run once on your computer: <code>{adb}</code>
            <CopyButton className="ibtn" text={adb}>Copy</CopyButton>
          </div>
        )}
        {env === 'lan' && <div className="endpoint-note">The phone and the computer must be on the same Wi-Fi.</div>}
      </Step>

      <Step n={2} title="Add to your app">
        <div className="guide-tabs">
          {STACKS.map(([id, label]) => (
            <button key={id} type="button" className={`guide-tab${stack === id ? ' on' : ''}`} onClick={() => setStack(id)}>{label}</button>
          ))}
        </div>
        <div className="guide-pane">
          {stack === 'flutter' && (
            <>
              <Code file="support_inspector_interceptor.dart" code={S.flutterInterceptor(url)} />
              <Code file="Where you create Dio" code={S.flutterRegister()} />
            </>
          )}
          {stack === 'android' && (
            <>
              <Code file="SupportInspectorInterceptor.kt" code={S.androidInterceptor(url)} />
              <Code file="Where you create OkHttpClient" code={S.androidRegister()} />
            </>
          )}
          {stack === 'ios' && (
            <>
              <Code file="SupportInspectorEventMonitor.swift" code={S.iosMonitor(url)} />
              <Code file="Where you create Alamofire Session" code={S.iosRegister()} />
            </>
          )}
          {stack === 'rn' && (
            <>
              <Code file="inspector.js" code={S.rnInspector(url)} />
              <Code file="Where you create axios" code={S.rnRegister()} />
            </>
          )}
          {stack === 'proxy' && (
            <>
              <p className="guide-desc">
                Set the phone's HTTP proxy (Wi-Fi settings → Proxy → Manual) to <code>{lanIp}</code> port <code>{port}</code>.
                HTTP requests show full headers and bodies; HTTPS only shows host, timing and size.
              </p>
              <Code file="Android emulator" code={S.emulatorProxy(port)} />
            </>
          )}
          {stack === 'curl' && <Code file="Terminal" code={S.curlIngest(url)} />}
        </div>
      </Step>
    </div>
  );
}
