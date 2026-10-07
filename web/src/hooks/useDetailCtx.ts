import { type DetailCtx, isSide, useLayout } from '../store/layout';
import { useNet } from '../store/net';

/** Which saved detail position applies: a narrow side-docked panel or a wide one. */
export function useDetailCtx(): DetailCtx {
  const debug = useNet((s) => s.mode === 'debug');
  const dock = useLayout((s) => s.dock);
  return debug || !isSide(dock) ? 'wide' : 'side';
}
