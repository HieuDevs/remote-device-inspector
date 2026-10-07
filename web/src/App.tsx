import { useEffect } from 'react';
import { Header } from './Header';
import { CurlModal } from './modals/CurlModal';
import { ExecModal } from './modals/ExecModal';
import { GuideModal } from './modals/GuideModal';
import { NetPanel } from './net/NetPanel';
import { useDetailCtx } from './hooks/useDetailCtx';
import { RemoteView } from './remote/RemoteView';
import { relay, useSession } from './remote/session';
import { load, save } from './lib/storage';
import { isSide, useLayout } from './store/layout';
import { type Mode, useModeData, useNet } from './store/net';
import { useUi } from './store/ui';

function setMode(mode: Mode): void {
  useNet.getState().setMode(mode);
  relay.setMode(mode);
  save('viewerMode', mode);
}

export function App() {
  const mode = useNet((s) => s.mode);
  const dock = useLayout((s) => s.dock);
  const netOpen = useLayout((s) => s.netOpen);
  const ctx = useDetailCtx();
  const detailPos = useLayout((s) => s.detailPos[ctx]);
  const detailOpen = !!useModeData().selectedId;
  const { curlOpen, guideOpen, exec } = useUi();
  const debug = mode === 'debug';
  const connected = useSession((s) => s.connected);

  // Start in the mode from ?mode=… or the last one used.
  useEffect(() => {
    const m = new URLSearchParams(location.search).get('mode') ?? load<string>('viewerMode', 'remote');
    setMode(m === 'debug' ? 'debug' : 'remote');
  }, []);

  const cls = [
    'app',
    `dock-${dock}`,
    isSide(dock) ? 'dock-side' : 'dock-band',
    `detail-${detailPos}`,
    detailPos === 'top' || detailPos === 'bottom' ? 'detail-col' : 'detail-row',
    debug && 'debug-mode',
    detailOpen && 'detail-open',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls}>
      <Header onMode={setMode} />
      <main>
        <RemoteView />
        <NetPanel visible={debug || (netOpen && connected)} />
      </main>
      {curlOpen && <CurlModal />}
      {exec && <ExecModal />}
      {guideOpen && <GuideModal />}
    </div>
  );
}
