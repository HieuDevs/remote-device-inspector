import { Activity, Network, Smartphone, Unplug } from 'lucide-react';
import { relay, useSession } from './remote/session';
import { useLayout } from './store/layout';
import { type Mode, useModeData, useNet } from './store/net';

export function Header({ onMode }: { onMode(m: Mode): void }) {
  const mode = useNet((s) => s.mode);
  const { status, tone, connected } = useSession();
  const netOpen = useLayout((s) => s.netOpen);
  const setNetOpen = useLayout((s) => s.setNetOpen);
  const count = useModeData().order.length;
  const remote = mode === 'remote';

  return (
    <header>
      <strong>Device Inspector</strong>
      <div className="seg">
        <button type="button" className={remote ? 'on' : ''} title="View and control a phone's screen" onClick={() => onMode('remote')}>
          <Smartphone size={14} /> Device
        </button>
        <button type="button" className={!remote ? 'on' : ''} title="Requests your app sends to /ingest or through the proxy" onClick={() => onMode('debug')}>
          <Activity size={14} /> API
        </button>
      </div>
      {remote && connected && (
        <>
          <button type="button" className={`ibtn${netOpen ? ' primary' : ''}`} title="The phone's requests" onClick={() => setNetOpen(!netOpen)}>
            <Network size={14} /> Network{count ? ` · ${count}` : ''}
          </button>
          <button type="button" className="ibtn" onClick={() => relay.leave()}>
            <Unplug size={14} /> Disconnect
          </button>
        </>
      )}
      <span className={`status ${tone}`}>{status}</span>
    </header>
  );
}
