// The single connection to the relay (/ws). Remote mode joins a device session
// by code (video + device flows, control back); debug mode listens to the
// standalone ingest feed and reconnects on its own.

import { create } from 'zustand';
import type { ControlMessage, DeviceInfo, ViewerMessage } from '@proto/flow';
import { type Mode, enqueueFlow, useNet } from '../store/net';
import { VideoPipe, webCodecsSupported } from './video';

export type Tone = 'idle' | 'ok' | 'warn';

interface SessionState {
  status: string;
  tone: Tone;
  /** a device session is open (remote mode) */
  connected: boolean;
  /** why the last join failed or ended, shown on the connect card */
  error: string;
}

export const useSession = create<SessionState>()(() => ({ status: 'Not connected', tone: 'idle', connected: false, error: '' }));

const setStatus = (status: string, tone: Tone = 'idle') => useSession.setState({ status, tone });

const CLOSE_REASONS: Record<number, string> = {
  4404: 'Wrong session code',
  4429: 'Too many wrong attempts. Try again in 10 minutes',
  4410: 'Session ended',
};

class RelaySession {
  private ws: WebSocket | null = null;
  private mode: Mode = 'remote';
  private reconnectTimer = 0;
  private device: { online: boolean; control: boolean; info?: DeviceInfo } = { online: false, control: false };
  private fps = 0;
  readonly video = new VideoPipe(() => this.send({ t: 'keyframe' }));

  constructor() {
    setInterval(() => {
      this.fps = this.video.takeFrameCount();
      if (this.mode === 'remote' && this.ws) this.refreshStatus();
    }, 1000);
  }

  /** Switch mode: closes the current connection; debug mode connects at once. */
  setMode(mode: Mode): void {
    this.mode = mode;
    this.disconnect();
    if (mode === 'debug') this.connectDebug();
    else setStatus('Not connected');
  }

  join(code: string): void {
    this.disconnect();
    if (!webCodecsSupported()) {
      useSession.setState({ error: "This browser doesn't support WebCodecs. Use a recent Chrome, Edge or Safari over HTTPS or localhost." });
      return;
    }
    const ws = this.open(`code=${encodeURIComponent(code)}`);
    ws.binaryType = 'arraybuffer';
    setStatus('Connecting…');
    useSession.setState({ error: '' });
    ws.onopen = () => useSession.setState({ connected: true });
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return this.video.push(ev.data as ArrayBuffer);
      const msg = JSON.parse(ev.data) as ViewerMessage;
      if (msg.type === 'status') {
        this.device = msg;
        this.refreshStatus();
      } else if (msg.type === 'api') {
        enqueueFlow(msg.flow, 'remote');
      }
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      setStatus('Not connected');
      useSession.setState({ connected: false, error: CLOSE_REASONS[ev.code] || '' });
      useNet.getState().setRecording(false, 'remote');
    };
  }

  leave(): void {
    this.disconnect();
    setStatus('Not connected');
  }

  send(msg: ControlMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private connectDebug(): void {
    const ws = this.open('mode=debug');
    setStatus('Connecting to the relay…');
    ws.onopen = () => {
      setStatus('Listening for requests', 'ok');
      useNet.getState().setRecording(true, 'debug');
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      try {
        const msg = JSON.parse(ev.data) as ViewerMessage;
        if (msg.type === 'api') enqueueFlow(msg.flow, 'debug');
      } catch {}
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      setStatus('Relay connection lost, retrying…', 'warn');
      useNet.getState().setRecording(false, 'debug');
      this.reconnectTimer = window.setTimeout(() => {
        if (this.mode === 'debug' && !this.ws) this.connectDebug();
      }, 3000);
    };
  }

  private open(query: string): WebSocket {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws?${query}`);
    return this.ws;
  }

  private disconnect(): void {
    clearTimeout(this.reconnectTimer);
    const ws = this.ws;
    this.ws = null; // handlers ignore events from a socket that is no longer current
    ws?.close();
    this.video.reset();
    useSession.setState({ connected: false });
  }

  private refreshStatus(): void {
    const d = this.device;
    const name = d.info?.model || 'Phone';
    if (!d.online) return setStatus(`${name} is offline…`, 'warn');
    if (!d.control) return setStatus(`${name} · view only (control is off)`, 'warn');
    setStatus(`${name} · ${this.fps} fps`, 'ok');
  }
}

export const relay = new RelaySession();
