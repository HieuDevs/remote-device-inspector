// Popup shell: backdrop click / Esc close, a corner handle to resize (size is
// remembered per popup) and a maximize toggle.

import { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { clamp } from '../lib/format';
import { useLayout } from '../store/layout';

interface Props {
  /** key for the remembered size */
  id: string;
  title: ReactNode;
  /** extra controls in the header, before maximize / close */
  actions?: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClose(): void;
  children: ReactNode;
}

export function Modal({ id, title, actions, className = '', style, onClose, children }: Props) {
  const saved = useLayout((s) => s.modalSize[id]);
  const setSize = useLayout((s) => s.setModalSize);
  const [max, setMax] = useState(false);
  const [resizing, setResizing] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const downOnBackdrop = useRef(false);
  // A resize that ends over the backdrop must not close the popup.
  const lastResizeAt = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = card.current;
    if (!el) return;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height };
    let size = { w: rect.width, h: rect.height };
    setMax(false);
    setResizing(true);
    document.body.classList.add('resizing-active');
    const move = (ev: PointerEvent) => {
      // Centered card: grow by 2× the pointer delta so the corner tracks the pointer.
      size = {
        w: Math.round(clamp(start.w + (ev.clientX - start.x) * 2, 360, window.innerWidth - 24)),
        h: Math.round(clamp(start.h + (ev.clientY - start.y) * 2, 280, window.innerHeight - 24)),
      };
      el.style.width = `${size.w}px`;
      el.style.height = `${size.h}px`;
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      document.body.classList.remove('resizing-active');
      setResizing(false);
      lastResizeAt.current = Date.now();
      setSize(id, size);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };

  const sizeStyle: CSSProperties = max ? {} : saved ? { width: saved.w, height: saved.h } : {};

  return createPortal(
    <div
      className="modal"
      onPointerDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdrop.current && Date.now() - lastResizeAt.current > 350) onClose();
        downOnBackdrop.current = false;
      }}
    >
      <div
        ref={card}
        className={`modal-card ${className}${max ? ' maximized' : ''}${resizing ? ' resizing' : ''}`}
        style={{ ...style, ...sizeStyle }}
      >
        <div className="modal-head">
          {title}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {actions}
            <button className="ibtn square ghost" title={max ? 'Restore' : 'Maximize'} onClick={() => setMax((m) => !m)}>
              {max ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button className="ibtn square ghost" title="Close (Esc)" onClick={onClose}><X size={15} /></button>
          </div>
        </div>
        {children}
        <div className="modal-resizer" title="Drag to resize" onPointerDown={startResize}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M11 3L3 11M11 7L7 11M11 11L10 11" />
          </svg>
        </div>
      </div>
    </div>,
    document.body,
  );
}
