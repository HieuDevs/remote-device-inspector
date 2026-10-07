import { bytesText } from '../lib/format';
import type { Stats } from '../hooks/useVisibleFlows';

const size = (n: number) => (n ? bytesText(n) : '0 B');
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`);

/** One-line summary of the rows currently shown. */
export function Footer({ stats }: { stats: Stats }) {
  return (
    <div className="net-foot">
      <span><b>{stats.count}</b> {stats.count === 1 ? 'request' : 'requests'}</span>
      <span>Sent <b>{size(stats.up)}</b></span>
      <span>Received <b>{size(stats.down)}</b></span>
      {stats.errors > 0 && <span className="err"><b>{stats.errors}</b> {stats.errors === 1 ? 'error' : 'errors'}</span>}
      {stats.slowest > 0 && <span title={stats.slowestHost}>Slowest <b>{ms(stats.slowest)}</b></span>}
    </div>
  );
}
