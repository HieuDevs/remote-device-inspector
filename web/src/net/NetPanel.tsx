// DevTools-style network panel: toolbar, stats, list + detail. Docks to any
// side of the remote screen (fills the window in debug mode); the detail can
// sit on any side of the list. Both splits are draggable and remembered.

import { type CSSProperties, useEffect } from 'react';
import { useDrag } from '../hooks/useDrag';
import { useVisibleFlows } from '../hooks/useVisibleFlows';
import { clamp } from '../lib/format';
import { useDetailCtx } from '../hooks/useDetailCtx';
import { isSide, useLayout } from '../store/layout';
import { getModeData, useModeData, useNet } from '../store/net';
import { ContextMenu } from './ContextMenu';
import { Detail } from './detail/Detail';
import { FlowList } from './FlowList';
import { Footer } from './Footer';
import { Toolbar } from './Toolbar';

// ↑/↓ walk the visible rows, Esc closes the detail. Ignored while typing or
// while the remote screen has focus (keys go to the device).
function useListKeys(ids: string[]): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.id === 'screen' || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      const { selectedId } = getModeData();
      const { select } = useNet.getState();
      if (e.key === 'Escape' && selectedId) {
        select(null);
        e.preventDefault();
        return;
      }
      if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || !ids.length) return;
      const i = selectedId ? ids.indexOf(selectedId) : -1;
      const next = e.key === 'ArrowDown' ? Math.min(ids.length - 1, i + 1) : Math.max(0, i - 1);
      select(ids[next]);
      requestAnimationFrame(() => document.querySelector('#netBody tr.sel')?.scrollIntoView({ block: 'nearest' }));
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ids]);
}

export function NetPanel({ visible }: { visible: boolean }) {
  const layout = useLayout();
  const ctx = useDetailCtx();
  const detailPos = layout.detailPos[ctx];
  const stacked = detailPos === 'top' || detailPos === 'bottom';
  const { rows, stats, buffered } = useVisibleFlows();
  const { selectedId, flows } = useModeData();
  const selected = selectedId ? flows[selectedId] : undefined;
  useListKeys(visible ? rows.map((r) => r.id) : []);

  // Outer edge: resize the panel against the viewer.
  const side = isSide(layout.dock);
  const outer = useDrag({
    axis: side ? 'col' : 'row',
    onMove: (e) => {
      const main = document.querySelector('main')!.getBoundingClientRect();
      if (side) {
        const raw = layout.dock === 'right' ? main.right - e.clientX : e.clientX - main.left;
        layout.setNetSize('side', Math.round(clamp(raw, 360, main.width - 220)));
      } else {
        const raw = layout.dock === 'bottom' ? main.bottom - e.clientY : e.clientY - main.top;
        layout.setNetSize('band', Math.round(clamp(raw, 160, main.height - 120)));
      }
    },
  });

  // Inner split: list vs detail.
  const split = useDrag({
    axis: stacked ? 'row' : 'col',
    onMove: (e) => {
      const box = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
      if (stacked) {
        const raw = detailPos === 'bottom' ? box.bottom - e.clientY : e.clientY - box.top;
        layout.setDetailSize('col', Math.round(clamp(raw, 160, box.height - 120)));
      } else {
        const raw = detailPos === 'right' ? box.right - e.clientX : e.clientX - box.left;
        layout.setDetailSize('row', Math.round(clamp(raw, 300, box.width - 280)));
      }
    },
  });

  const netStyle: CSSProperties = side
    ? (layout.netSize.side ? { width: layout.netSize.side } : {})
    : (layout.netSize.band ? { height: layout.netSize.band } : {});
  const detailStyle: CSSProperties = stacked
    ? (layout.detailSize.col ? { height: layout.detailSize.col } : {})
    : (layout.detailSize.row ? { width: layout.detailSize.row } : {});

  return (
    <section id="net" className={visible ? '' : 'hidden'} style={netStyle}>
      <div id="netResize" title="Drag to resize the panel" {...outer} />
      <Toolbar buffered={buffered} />
      <div className="net-body">
        <FlowList rows={rows} />
        {selected && (
          <>
            <div id="splitResize" title="Drag to resize the list and details" {...split} />
            <Detail r={selected} style={detailStyle} />
          </>
        )}
      </div>
      <Footer stats={stats} />
      <ContextMenu />
    </section>
  );
}
