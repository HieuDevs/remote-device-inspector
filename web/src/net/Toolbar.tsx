import { BookOpen, CircleHelp, Download, Ellipsis, Pause, Play, Search, Terminal, Trash2, X } from 'lucide-react';
import type { FilterKind } from '../lib/filter';
import { buildHar } from '../lib/har';
import { downloadBlob } from '../lib/clipboard';
import { type Pos, useLayout } from '../store/layout';
import { useModeData, useNet } from '../store/net';
import { useUi } from '../store/ui';
import { Menu, MenuItem } from './Menu';
import { useDetailCtx } from '../hooks/useDetailCtx';
import { PosPicker } from './PosPicker';

const CHIPS: { kind: FilterKind; label: string; remoteOnly?: boolean }[] = [
  { kind: 'all', label: 'All' },
  { kind: 'pinned', label: '★ Pinned' },
  { kind: 'err', label: 'Errors' },
  { kind: 'http', label: 'HTTP' },
  { kind: 'https', label: 'HTTPS' },
  { kind: 'ws', label: 'WS' },
  { kind: 'dns', label: 'DNS', remoteOnly: true },
];

const FILTER_HELP: [string, string][] = [
  ['login', 'text in the URL, headers or body'],
  ['status:4xx', 'status 4xx (2xx, 5xx, err…)'],
  ['method:post', 'by method'],
  ['host:api', 'by host'],
  ['type:json', 'by content type'],
  ['ms:>500', 'slower than 500 ms'],
  ['size:>50kb', 'larger than 50 KB'],
  ['slow', 'slow (≥ 800 ms)'],
];

function exportHar(): void {
  const s = useNet.getState();
  const d = s.data[s.mode];
  const har = buildHar(d.order.map((id) => d.flows[id]).filter(Boolean));
  if (!har) return alert('No HTTP requests to export.');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  downloadBlob(new Blob([JSON.stringify(har, null, 2)], { type: 'application/json' }), `requests_${ts}.har`);
}

const DOCK_TITLES: Record<Pos, string> = { top: 'Top', bottom: 'Bottom', left: 'Left', right: 'Right' };

export function Toolbar({ buffered }: { buffered: number }) {
  const { filter, apps, recording, frozen } = useModeData();
  const mode = useNet((s) => s.mode);
  const { setFilter, togglePause, clear } = useNet.getState();
  const layout = useLayout();
  const ctx = useDetailCtx();
  const ui = useUi.getState();
  const paused = !!frozen;
  const remote = mode === 'remote';

  const onClear = () => {
    clear();
    if (!remote) fetch('/clear', { method: 'POST' }).catch(() => {});
  };

  return (
    <div className="net-tools">
      <button
        type="button"
        className={`ibtn rec-btn${paused ? ' paused' : ''}`}
        title={paused ? 'Resume showing new requests' : 'Pause: freeze the list'}
        onClick={togglePause}
      >
        {paused ? <Play size={13} /> : <span className={`rec${recording ? '' : ' off'}`}><span className="dot" /></span>}
        {paused ? `Resume${buffered ? ` · ${buffered} new` : ''}` : recording ? 'Recording' : 'Not recording'}
        {!paused && <Pause size={12} className="rec-pause" />}
      </button>

      <label className="search">
        <Search size={14} />
        <input
          id="netFilter"
          placeholder="Filter requests…"
          autoComplete="off"
          value={filter.text}
          onChange={(e) => setFilter({ text: e.target.value })}
        />
        {filter.text && (
          <button type="button" className="ibtn square ghost" title="Clear filter" onClick={() => setFilter({ text: '' })}>
            <X size={13} />
          </button>
        )}
      </label>
      <Menu label={<CircleHelp size={15} />} title="Filter syntax" className="ibtn square ghost" align="left">
        {() => (
          <div className="filter-help">
            {FILTER_HELP.map(([q, d]) => (
              <div className="fh-row" key={q}>
                <code>{q}</code>
                <span>{d}</span>
              </div>
            ))}
            <div className="fh-row"><span /><span>Combine conditions with spaces.</span></div>
          </div>
        )}
      </Menu>

      <div className="seg small">
        {CHIPS.filter((c) => remote || !c.remoteOnly).map((c) => (
          <button key={c.kind} type="button" className={filter.kind === c.kind ? 'on' : ''} onClick={() => setFilter({ kind: c.kind })}>
            {c.label}
          </button>
        ))}
      </div>
      {apps.length > 1 && (
        <select id="appFilter" title="Filter by app" value={filter.app} onChange={(e) => setFilter({ app: e.target.value })}>
          <option value="">All apps</option>
          {apps.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      )}

      <span className="tools-sp" />
      <button type="button" className="ibtn" title="Paste a cURL command to run or compare" onClick={() => ui.openCurl()}>
        <Terminal size={14} /> cURL
      </button>
      <button type="button" className="ibtn square" title="Clear the list" onClick={onClear}>
        <Trash2 size={14} />
      </button>
      <Menu label={<Ellipsis size={16} />} title="More">
        {(close) => (
          <>
            <MenuItem icon={<Download size={14} />} onClick={() => { close(); exportHar(); }}>Export HAR</MenuItem>
            <MenuItem icon={<BookOpen size={14} />} onClick={() => { close(); ui.setGuideOpen(true); }}>Connect your app</MenuItem>
            <div className="menu-sep" />
            {remote && (
              <div className="menu-row">
                Panel position
                <PosPicker title="Panel position" value={layout.dock} onChange={layout.setDock} titles={DOCK_TITLES} />
              </div>
            )}
            <div className="menu-row">
              Details position
              <PosPicker title="Details position" value={layout.detailPos[ctx]} onChange={(p) => layout.setDetailPos(ctx, p)} titles={DOCK_TITLES} />
            </div>
          </>
        )}
      </Menu>
      {remote && (
        <button type="button" className="ibtn square ghost" title="Close" onClick={() => layout.setNetOpen(false)}>
          <X size={15} />
        </button>
      )}
    </div>
  );
}
