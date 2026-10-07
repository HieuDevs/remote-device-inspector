// Captured flows, per mode. Remote-agent traffic and standalone-debug traffic
// are kept apart; switching mode switches the whole list, filters and selection.

import { create } from 'zustand';
import type { Flow } from '@proto/flow';
import type { FilterState } from '../lib/filter';

export type Mode = 'remote' | 'debug';

export interface ModeData {
  flows: Record<string, Flow>;
  /** newest first */
  order: string[];
  apps: string[];
  firstTs: number;
  maxEnd: number;
  selectedId: string | null;
  filter: FilterState;
  recording: boolean;
  /** ids shown while paused; new rows wait until resume */
  frozen: string[] | null;
}

const MAX_FLOWS = 800;

const empty = (): ModeData => ({
  flows: {},
  order: [],
  apps: [],
  firstTs: 0,
  maxEnd: 0,
  selectedId: null,
  filter: { text: '', kind: 'all', app: '' },
  recording: false,
  frozen: null,
});

interface NetState {
  mode: Mode;
  data: Record<Mode, ModeData>;
  setMode(mode: Mode): void;
  /** Merge a batch of flow updates (same id = same row). */
  ingest(flows: Flow[], mode: Mode): void;
  setRecording(on: boolean, mode: Mode): void;
  select(id: string | null): void;
  togglePin(id: string): void;
  setFilter(f: Partial<FilterState>): void;
  togglePause(): void;
  clear(): void;
}

// Drop the oldest rows above the cap, keeping pinned and selected ones.
function prune(d: ModeData): void {
  if (d.order.length <= MAX_FLOWS + 40) return;
  const keep: string[] = [];
  let excess = d.order.length - MAX_FLOWS;
  for (let i = d.order.length - 1; i >= 0; i--) {
    const id = d.order[i];
    if (excess > 0 && !d.flows[id]?.pinned && id !== d.selectedId) {
      delete d.flows[id];
      excess--;
    } else keep.push(id);
  }
  d.order = keep.reverse();
}

export const useNet = create<NetState>()((set) => {
  // Apply a change to one mode's data (copy-on-write at the mode level).
  const patch = (mode: Mode | null, fn: (d: ModeData) => Partial<ModeData> | void) =>
    set((s) => {
      const m = mode ?? s.mode;
      const d = { ...s.data[m] };
      Object.assign(d, fn(d) || {});
      return { data: { ...s.data, [m]: d } };
    });

  return {
    mode: 'remote',
    data: { remote: empty(), debug: empty() },

    setMode: (mode) => set({ mode }),

    ingest: (batch, mode) =>
      patch(mode, (d) => {
        const flows = { ...d.flows };
        let order = d.order;
        let apps = d.apps;
        let { firstTs, maxEnd, recording } = d;
        for (const f of batch) {
          if (f.ev === 'capture') { recording = !!f.on; continue; }
          const prev = flows[f.id];
          if (!prev) order = [f.id, ...order];
          const r: Flow = { ...prev, ...f, pinned: prev?.pinned ?? f.pinned };
          flows[f.id] = r;
          if (r.app && !apps.includes(r.app)) apps = [...apps, r.app];
          if (r.t) {
            if (!firstTs || r.t < firstTs) firstTs = r.t;
            maxEnd = Math.max(maxEnd, r.t + (r.ms || 0));
          }
        }
        const next: ModeData = { ...d, flows, order, apps, firstTs, maxEnd, recording };
        prune(next);
        return next;
      }),

    setRecording: (on, mode) => patch(mode, () => ({ recording: on })),

    select: (id) => patch(null, () => ({ selectedId: id })),

    togglePin: (id) =>
      patch(null, (d) => {
        const r = d.flows[id];
        if (r) return { flows: { ...d.flows, [id]: { ...r, pinned: !r.pinned } } };
      }),

    setFilter: (f) => patch(null, (d) => ({ filter: { ...d.filter, ...f } })),

    togglePause: () => patch(null, (d) => ({ frozen: d.frozen ? null : [...d.order] })),

    clear: () =>
      patch(null, (d) => ({ ...empty(), filter: { ...d.filter, app: '' }, recording: d.recording })),
  };
});

export const useModeData = (): ModeData => useNet((s) => s.data[s.mode]);
export const getModeData = (): ModeData => {
  const s = useNet.getState();
  return s.data[s.mode];
};

// Flows arrive in bursts (ingest, proxy, device VPN); apply them in batches.
// setTimeout, not requestAnimationFrame: rAF stops in a background tab.
const queue: { flow: Flow; mode: Mode }[] = [];
let scheduled = false;

export function enqueueFlow(flow: Flow, mode: Mode): void {
  queue.push({ flow, mode });
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    const batch = queue.splice(0);
    const { ingest } = useNet.getState();
    for (const m of ['remote', 'debug'] as const) {
      const flows = batch.filter((b) => b.mode === m).map((b) => b.flow);
      if (flows.length) ingest(flows, m);
    }
  }, 16);
}
