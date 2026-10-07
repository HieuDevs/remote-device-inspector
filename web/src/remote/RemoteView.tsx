// The device screen: decoded video on a canvas, with mouse / keyboard mapped
// to touch and key events. Coordinates are normalized to 0..1, so they do not
// depend on the video resolution or device size. Before a session is joined
// it shows how to connect.

import { ArrowLeft, Bell, Circle, Lock, Square, Sun } from 'lucide-react';
import { type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { clamp } from '../lib/format';
import { relay, useSession } from './session';

const KEYS: [key: string, label: string, icon: ReactNode][] = [
  ['back', 'Back', <ArrowLeft size={15} />],
  ['home', 'Home', <Circle size={15} />],
  ['recents', 'Recents', <Square size={14} />],
  ['notifications', 'Notifications', <Bell size={15} />],
  ['lock', 'Lock screen', <Lock size={15} />],
  ['wake', 'Wake screen', <Sun size={15} />],
];

function ConnectCard() {
  const error = useSession((s) => s.error);
  const status = useSession((s) => s.status);
  const [code, setCode] = useState('');
  const digits = code.replace(/\D/g, '');
  return (
    <div className="connect-card">
      <h2>Connect a phone</h2>
      <p>View and control a phone's screen from your browser.</p>
      <ol>
        <li>Open <b>Remote Agent</b> on the phone.</li>
        <li>Tap <b>Start sharing</b> to get a 9-digit session code.</li>
        <li>Enter the code below.</li>
      </ol>
      <form onSubmit={(e) => { e.preventDefault(); relay.join(digits); }}>
        <input
          inputMode="numeric"
          autoComplete="off"
          placeholder="123 456 789"
          maxLength={11}
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <button className="primary" type="submit" disabled={digits.length !== 9 || status === 'Connecting…'}>
          Connect
        </button>
      </form>
      <div className="err">{error}</div>
    </div>
  );
}

export function RemoteView() {
  const connected = useSession((s) => s.connected);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    relay.video.attach(canvas.current);
    return () => relay.video.attach(null);
  }, []);
  useEffect(() => { if (connected) canvas.current?.focus(); }, [connected]);

  // Pointer / wheel / keys → control messages. Plain listeners: wheel needs
  // passive:false, and drag state lives across events.
  useEffect(() => {
    const el = canvas.current!;
    const send = relay.send.bind(relay);
    const norm = (e: { clientX: number; clientY: number }): [number, number] => {
      const r = el.getBoundingClientRect();
      return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)];
    };

    // Real-time touch: stream down/move/up so drags and scrolls feel live on
    // the device (moves coalesced to one per animation frame).
    let dragging = false;
    let pendingMove: [number, number] | null = null;
    const flushMove = () => {
      if (pendingMove && dragging) send({ t: 'move', x: pendingMove[0], y: pendingMove[1] });
      pendingMove = null;
    };

    // Mouse wheel → one continuous drag that follows the wheel.
    let wheel: { x: number; y: number } | null = null;
    let wheelTimer = 0;
    const endWheel = () => {
      if (!wheel) return;
      clearTimeout(wheelTimer);
      send({ t: 'up', x: wheel.x, y: wheel.y });
      wheel = null;
    };

    const onMoveCursor = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      cursor.current!.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`;
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      cursor.current!.classList.add('press');
      ripple(e);
      endWheel(); // don't mix a wheel-scroll with a finger drag
      dragging = true;
      const [x, y] = norm(e);
      send({ t: 'down', x, y });
    };
    const onMove = (e: PointerEvent) => {
      onMoveCursor(e);
      if (!dragging) return;
      const had = pendingMove;
      pendingMove = norm(e);
      if (!had) requestAnimationFrame(flushMove);
    };
    const onUp = (e: PointerEvent) => {
      cursor.current!.classList.remove('press');
      if (!dragging) return;
      dragging = false;
      pendingMove = null;
      const [x, y] = norm(e);
      send({ t: 'up', x, y });
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (dragging) return;
      if (!wheel) {
        const [x, y] = norm(e);
        wheel = { x, y };
        send({ t: 'down', x, y });
      }
      // The finger moves opposite to the content scroll direction.
      wheel.y = clamp(wheel.y - Math.sign(e.deltaY) * 0.06, 0.02, 0.98);
      send({ t: 'move', x: wheel.x, y: wheel.y });
      clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(endWheel, 130);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const named = ({ Backspace: 'backspace', Enter: 'enter', Escape: 'back' } as Record<string, string>)[e.key];
      if (named) send({ t: 'key', k: named });
      else if (e.key.length === 1) send({ t: 'type', s: e.key });
      else return;
      e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text');
      if (text) send({ t: 'type', s: text.slice(0, 1000) });
    };
    // Right click = Back, like scrcpy.
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      send({ t: 'key', k: 'back' });
    };
    const onEnter = () => stage.current!.classList.add('active');
    const onLeave = () => {
      stage.current!.classList.remove('active');
      cursor.current!.classList.remove('press');
    };

    // Show a ripple where a tap landed, so the action is obvious.
    const ripple = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const dot = document.createElement('div');
      dot.className = 'ripple';
      dot.style.left = `${e.clientX - r.left}px`;
      dot.style.top = `${e.clientY - r.top}px`;
      overlay.current!.appendChild(dot);
      setTimeout(() => dot.remove(), 500);
    };

    const listeners: [string, EventListener, AddEventListenerOptions?][] = [
      ['pointerenter', onEnter],
      ['pointerleave', onLeave],
      ['pointerdown', onDown as EventListener],
      ['pointermove', onMove as EventListener],
      ['pointerup', onUp as EventListener],
      ['pointercancel', onUp as EventListener],
      ['wheel', onWheel as EventListener, { passive: false }],
      ['keydown', onKey as EventListener],
      ['paste', onPaste as EventListener],
      ['contextmenu', onContext as EventListener],
    ];
    for (const [type, fn, opts] of listeners) el.addEventListener(type, fn, opts);
    return () => {
      for (const [type, fn] of listeners) el.removeEventListener(type, fn);
      clearTimeout(wheelTimer);
    };
  }, []);

  const pressKey = (k: string) => (e: ReactMouseEvent) => {
    e.preventDefault();
    relay.send({ t: 'key', k });
    canvas.current?.focus();
  };

  // The canvas stays mounted (the decoder draws into it); it is only hidden
  // while there is no session.
  return (
    <div className="viewer">
      {!connected && <ConnectCard />}
      <div id="stage" ref={stage} hidden={!connected}>
        <canvas id="screen" ref={canvas} width={360} height={780} tabIndex={0} />
        <div id="overlay" ref={overlay}><div id="cursor" ref={cursor} /></div>
      </div>
      {connected && (
        <nav className="remote-keys">
          {KEYS.map(([k, label, icon]) => (
            <button key={k} className="ibtn" onClick={pressKey(k)}>{icon} {label}</button>
          ))}
          <p className="hint">Click to tap, drag to swipe, scroll to scroll, right-click for Back, type to enter text.</p>
        </nav>
      )}
    </div>
  );
}
