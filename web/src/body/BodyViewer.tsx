// Body viewer: picks views from the content (see analyzeBody), with search,
// copy and download. Re-rendered in place while a stream grows, so the view,
// the search and the scroll position survive updates.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  type BodyInfo, type BodySource, type BodyView, KIND_LABEL, VIEW_LABEL, analyzeBody,
} from '../lib/body/analyze';
import { hexDump } from '../lib/body/hex';
import { highlightJsonHtml } from '../lib/body/highlightJson';
import { jsonText, tryJson } from '../lib/body/json';
import { clearHits, findRanges, scrollRangeIntoView, setHits } from '../lib/body/search';
import { prettyXml } from '../lib/body/xml';
import { downloadBlob } from '../lib/clipboard';
import { bytesText } from '../lib/format';
import { CopyButton } from '../net/CopyButton';
import { useLayout } from '../store/layout';
import { JsonTree } from './JsonTree';

/** Above this a JSON body is shown as highlighted text instead of a tree. */
const TREE_MAX_CHARS = 600_000;
const HEX_PAGE = 64 * 1024;

interface Props {
  src: BodySource;
  title: string;
  /** download file name */
  name?: string;
  /** keep scrolled to the bottom while new data arrives (live streams) */
  follow?: boolean;
}

export function BodyViewer({ src, title, name = 'body', follow = false }: Props) {
  const info = useMemo(() => analyzeBody(src), [src.raw, src.enc, src.ctype]);
  const pref = useLayout((s) => s.bodyView[info.kind]);
  const setPref = useLayout((s) => s.setBodyView);
  const [picked, setPicked] = useState<BodyView | null>(null);
  const view = [picked, pref].find((v): v is BodyView => !!v && info.views.includes(v)) ?? info.views[0];

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [hitCount, setHitCount] = useState(0);
  const viewRef = useRef<HTMLDivElement>(null);
  const ranges = useRef<Range[]>([]);
  const owner = useRef({});
  const atBottom = useRef(true);

  // Search: find hits in whatever the view rendered, paint them, scroll to the active one.
  useLayoutEffect(() => {
    const root = viewRef.current;
    if (!root || !query) {
      ranges.current = [];
      clearHits(owner.current);
      setHitCount(0);
      return;
    }
    const found = findRanges(root, query);
    ranges.current = found;
    setHitCount(found.length);
    const cur = found.length ? found[((active % found.length) + found.length) % found.length] : null;
    setHits(owner.current, found, cur);
    if (cur) scrollRangeIntoView(cur);
  }, [query, active, view, info]);
  useEffect(() => () => clearHits(owner.current), []);

  // Live streams: stay pinned to the bottom if the user was there.
  useLayoutEffect(() => {
    const el = viewRef.current;
    if (follow && el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [info, follow]);

  const step = (d: number) => setActive((a) => a + d);
  const shownIdx = hitCount ? (((active % hitCount) + hitCount) % hitCount) + 1 : 0;

  const copyText = () => textFor(info, view);
  const download = () => {
    const part = info.bytes ? new Uint8Array(info.bytes) : info.raw;
    downloadBlob(new Blob([part], { type: info.mime || 'text/plain' }), name);
  };

  return (
    <div className="body-wrap">
      <div className="bhead">
        <span className="sec-title">{title}</span>
        <span className="bkind">
          {KIND_LABEL[info.kind]}
          {info.mime && info.kind !== 'text' ? ` · ${info.mime}` : ''} · {bytesText(info.size)}
        </span>
        {info.views.length > 1 && (
          <span className="bviews">
            {info.views.map((v) => (
              <button
                key={v}
                type="button"
                className={v === view ? 'on' : ''}
                onClick={() => { setPicked(v); setPref(info.kind, v); }}
              >
                {VIEW_LABEL[v]}
              </button>
            ))}
          </span>
        )}
        <span className="bsp" />
        <CopyButton className="copy" text={copyText}>Copy</CopyButton>
        <button type="button" className="copy" title="Download the body" onClick={download}>Download</button>
      </div>
      {info.note && <div className="bnote">{info.note}</div>}
      {view !== 'preview' && (
        <div className="body-search">
          <input
            type="search"
            placeholder="Search body"
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
            }}
          />
          <span className="bs-count">{!query ? '' : hitCount ? `${shownIdx}/${hitCount}` : 'No results'}</span>
          <button type="button" title="Previous (Shift+Enter)" onClick={() => step(-1)}>↑</button>
          <button type="button" title="Next (Enter)" onClick={() => step(1)}>↓</button>
        </div>
      )}
      <div
        ref={viewRef}
        className={`bview v-${view}${view === 'pretty' && info.kind === 'json' && info.raw.length < TREE_MAX_CHARS ? ' jtree' : ''}`}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
        }}
      >
        <ViewContent info={info} view={view} searching={!!query} />
      </div>
    </div>
  );
}

/** What Copy puts on the clipboard for the current view. */
function textFor(info: BodyInfo, view: BodyView): string {
  if (view === 'pretty' && info.json) return jsonText(info.json);
  if (view === 'pretty' && info.kind === 'xml') return prettyXml(info.text);
  if (view === 'source') return info.kind === 'svg' ? prettyXml(info.text) : info.text;
  if (view === 'lines' && info.lines) return info.lines.map((l) => (l.json ? jsonText(l.json) : l.text)).join('\n');
  if (view === 'table') return [...new URLSearchParams(info.text.trim())].map(([k, v]) => `${k}: ${v}`).join('\n');
  return info.bytes ? info.raw : info.text;
}

function ViewContent({ info, view, searching }: { info: BodyInfo; view: BodyView; searching: boolean }) {
  switch (view) {
    case 'pretty':
      if (info.kind === 'json' && info.json) {
        return info.raw.length < TREE_MAX_CHARS
          ? <JsonTree node={info.json} forceOpen={searching} />
          : <pre dangerouslySetInnerHTML={{ __html: highlightJsonHtml(info.raw) }} />;
      }
      return <pre>{prettyXml(info.text)}</pre>;
    case 'source':
      return <pre>{info.kind === 'svg' ? prettyXml(info.text) : info.text}</pre>;
    case 'events':
      return <SseEvents info={info} searching={searching} />;
    case 'lines':
      return (
        <>
          {(info.lines ?? []).map((l, i) => (
            <div className="ev" key={i}>
              <div className="ev-head"><span className="ev-n">#{i + 1}</span></div>
              {l.json ? <div className="jtree"><JsonTree node={l.json} forceOpen={searching} /></div> : <pre>{l.text}</pre>}
            </div>
          ))}
        </>
      );
    case 'table': {
      const rows = [...new URLSearchParams(info.text.trim())];
      return (
        <div className="hdrs">
          <div className="h">
            {rows.map(([k, v], i) => (
              <Pair key={i} k={k} v={v} />
            ))}
          </div>
        </div>
      );
    }
    case 'preview':
      return <Preview info={info} />;
    case 'hex':
      return <Hex bytes={info.bytes ?? new Uint8Array()} />;
    default:
      return <pre>{info.bytes ? info.raw : info.text}</pre>;
  }
}

const Pair = ({ k, v }: { k: string; v: string }) => (<><dt>{k}</dt><dd>{v}</dd></>);

function SseEvents({ info, searching }: { info: BodyInfo; searching: boolean }) {
  const events = info.events ?? [];
  if (!events.length) return <div className="hint" style={{ maxWidth: 'none' }}>No events yet</div>;
  return (
    <>
      {events.map((e, i) => {
        const data = e.data.join('\n');
        const json = tryJson(data);
        return (
          <div className="ev" key={i}>
            <div className="ev-head">
              <span className="ev-n">#{i + 1}</span>
              {e.event
                ? <span className="ev-tag">{e.event}</span>
                : <span className="ev-tag dim">{e.data.length ? 'message' : 'comment'}</span>}
              {e.id && <span className="ev-meta">id: {e.id}</span>}
              {e.retry && <span className="ev-meta">retry: {e.retry}</span>}
              {e.partial && <span className="ev-meta warn">receiving…</span>}
            </div>
            {e.comments.length > 0 && <pre className="ev-com">{e.comments.map((c) => ': ' + c).join('\n')}</pre>}
            {json ? <div className="jtree"><JsonTree node={json} forceOpen={searching} /></div> : e.data.length > 0 && <pre>{data}</pre>}
          </div>
        );
      })}
    </>
  );
}

function Preview({ info }: { info: BodyInfo }) {
  const [dims, setDims] = useState<string | null>(null);
  const url = useMemo(() => {
    if (info.kind === 'html') return null;
    const type = info.kind === 'svg' && !info.bytes ? 'image/svg+xml' : info.mime || 'application/octet-stream';
    const part = info.bytes ? new Uint8Array(info.bytes) : info.text;
    return URL.createObjectURL(new Blob([part], { type }));
  }, [info]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  switch (info.kind) {
    case 'image':
    case 'svg':
      return (
        <>
          <div className="bimg">
            <img
              alt=""
              src={url!}
              onLoad={(e) => setDims(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight} px · ${bytesText(info.size)}`)}
              onError={() => setDims("Can't display this image")}
            />
          </div>
          <div className="bimg-meta">{dims}</div>
        </>
      );
    case 'pdf':
      return <iframe className="bframe" title="PDF" src={url!} />;
    case 'audio':
      return <audio controls src={url!} />;
    case 'video':
      return <video className="bvideo" controls src={url!} />;
    case 'html':
      // Sandboxed with no permissions: scripts, forms and navigation are off.
      return <iframe className="bframe" title="HTML" sandbox="" srcDoc={info.text} />;
    default:
      return null;
  }
}

function Hex({ bytes }: { bytes: Uint8Array }) {
  const [shown, setShown] = useState(() => Math.min(bytes.length, HEX_PAGE));
  const text = useMemo(() => hexDump(bytes, 0, Math.min(shown, bytes.length)), [bytes, shown]);
  return (
    <>
      <pre>{text}</pre>
      {shown < bytes.length && (
        <button type="button" className="ibtn bmore" onClick={() => setShown((n) => n + HEX_PAGE)}>
          Show more ({bytesText(shown)} / {bytesText(bytes.length)})
        </button>
      )}
    </>
  );
}
