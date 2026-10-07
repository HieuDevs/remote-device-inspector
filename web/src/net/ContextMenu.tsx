import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { prettyBody } from '../lib/body/json';
import { copyToClipboard } from '../lib/clipboard';
import { curlOf } from '../lib/curl';
import { hostOf, isHttp, urlOf } from '../lib/flow';
import { useNet } from '../store/net';
import { useUi } from '../store/ui';
import { editAndResend, replay } from './actions';
import { MenuItem } from './Menu';
import { Copy, Filter, Pencil, RotateCw, Star } from 'lucide-react';

export function ContextMenu() {
  const menu = useUi((s) => s.menu);
  const flow = useNet((s) => (menu ? s.data[s.mode].flows[menu.id] : undefined));
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const close = useUi.getState().closeMenu;

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const { offsetWidth: w, offsetHeight: h } = ref.current;
    setPos({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - w - 12)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - h - 12)),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onContext = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.context-menu, table.net tr')) close();
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu, close]);

  if (!menu || !flow) return null;

  const act = (fn: () => void) => () => {
    close();
    fn();
  };
  const net = useNet.getState();

  return (
    <div ref={ref} className="context-menu menu" style={pos} onClick={(e) => e.stopPropagation()}>
      {isHttp(flow) && (
        <>
          <MenuItem icon={<RotateCw size={14} />} onClick={act(() => replay(flow))}>Resend</MenuItem>
          <MenuItem icon={<Pencil size={14} />} onClick={act(() => editAndResend(flow))}>Edit and resend</MenuItem>
        </>
      )}
      <MenuItem icon={<Star size={14} />} onClick={act(() => net.togglePin(flow.id))}>{flow.pinned ? 'Unpin' : 'Pin'}</MenuItem>
      <div className="menu-sep" />
      <MenuItem icon={<Copy size={14} />} onClick={act(() => copyToClipboard(urlOf(flow)))}>Copy URL</MenuItem>
      {isHttp(flow) && <MenuItem icon={<Copy size={14} />} onClick={act(() => copyToClipboard(curlOf(flow)))}>Copy cURL</MenuItem>}
      {(flow.respBody || flow.reqBody) && (
        <MenuItem icon={<Copy size={14} />} onClick={act(() => copyToClipboard(prettyBody(flow.respBody || flow.reqBody || '')))}>Copy body</MenuItem>
      )}
      <div className="menu-sep" />
      <MenuItem icon={<Filter size={14} />} onClick={act(() => net.setFilter({ text: hostOf(flow) }))}>Only this host</MenuItem>
      {flow.app && <MenuItem icon={<Filter size={14} />} onClick={act(() => net.setFilter({ app: flow.app }))}>Only this app</MenuItem>}
    </div>
  );
}
