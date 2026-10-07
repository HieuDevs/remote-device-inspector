import { type MouseEvent, useCallback } from 'react';
import type { Flow } from '@proto/flow';
import { IntegrationGuide } from '../guide/IntegrationGuide';
import { useModeData, useNet } from '../store/net';
import { useUi } from '../store/ui';
import { FlowRow } from './FlowRow';

export function FlowList({ rows }: { rows: Flow[] }) {
  const { selectedId, firstTs, maxEnd, order } = useModeData();
  const mode = useNet((s) => s.mode);
  const span = Math.max(1, maxEnd - firstTs);

  const onSelect = useCallback((id: string) => useNet.getState().select(id), []);
  const onPin = useCallback((id: string) => useNet.getState().togglePin(id), []);
  const onMenu = useCallback((e: MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    useNet.getState().select(id);
    useUi.getState().openMenu(e.clientX, e.clientY, id);
  }, []);

  return (
    <div className="net-list">
      <table className="net">
        <thead>
          <tr>
            <th style={{ width: '44%' }}>Name</th>
            <th>Status</th>
            <th>Method</th>
            <th>Type</th>
            <th>Size</th>
            <th>Time</th>
            <th style={{ width: '16%' }}>Timeline</th>
          </tr>
        </thead>
        <tbody id="netBody">
          {rows.map((r) => (
            <FlowRow key={r.id} r={r} selected={r.id === selectedId} firstTs={firstTs} span={span} onSelect={onSelect} onMenu={onMenu} onPin={onPin} />
          ))}
        </tbody>
      </table>
      {order.length === 0 && (
        <div id="netEmpty">
          {mode === 'remote' ? (
            <div className="empty-remote">
              <div className="big">No requests yet</div>
              <div className="hint" style={{ maxWidth: 'none' }}>The phone's requests appear here while Remote Agent is sharing.</div>
            </div>
          ) : (
            <div className="empty-debug">
              <div className="dg-header">
                <div className="dg-title">No requests yet</div>
                <div className="dg-subtitle">Point your app at the address below. Requests appear here as soon as it calls an API.</div>
              </div>
              <IntegrationGuide />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
