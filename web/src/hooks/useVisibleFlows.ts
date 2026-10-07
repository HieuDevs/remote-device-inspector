import { useMemo } from 'react';
import type { Flow } from '@proto/flow';
import { matches } from '../lib/filter';
import { useModeData } from '../store/net';

export interface Stats {
  count: number;
  up: number;
  down: number;
  errors: number;
  slowest: number;
  slowestHost: string;
}

/** Rows after filters (and pause), newest first, plus the stats strip numbers. */
export function useVisibleFlows(): { rows: Flow[]; stats: Stats; buffered: number } {
  const d = useModeData();
  return useMemo(() => {
    const frozen = d.frozen ? new Set(d.frozen) : null;
    const rows: Flow[] = [];
    const stats: Stats = { count: 0, up: 0, down: 0, errors: 0, slowest: 0, slowestHost: '' };
    for (const id of d.order) {
      const r = d.flows[id];
      if (!r || (frozen && !frozen.has(id)) || !matches(r, d.filter)) continue;
      rows.push(r);
      stats.count++;
      stats.up += r.up || 0;
      stats.down += r.down || 0;
      if ((r.status ?? 0) >= 400) stats.errors++;
      if ((r.ms || 0) > stats.slowest) {
        stats.slowest = r.ms || 0;
        stats.slowestHost = r.host || r.dstIp || '';
      }
    }
    const buffered = frozen ? d.order.filter((id) => !frozen.has(id)).length : 0;
    return { rows, stats, buffered };
  }, [d.order, d.flows, d.filter, d.frozen]);
}
