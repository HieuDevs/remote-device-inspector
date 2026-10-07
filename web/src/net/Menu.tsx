import { type ReactNode, useEffect, useRef, useState } from 'react';

interface Props {
  /** button content */
  label: ReactNode;
  title: string;
  className?: string;
  align?: 'left' | 'right';
  /** menu body; call close() after an action */
  children: (close: () => void) => ReactNode;
}

/** Button + popover. Closes on outside click and Esc. */
export function Menu({ label, title, className = 'ibtn square', align = 'right', children }: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={wrap}>
      <button type="button" className={className} title={title} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && <div className={`menu ${align}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

interface ItemProps {
  icon?: ReactNode;
  onClick(): void;
  children: ReactNode;
}

export function MenuItem({ icon, onClick, children }: ItemProps) {
  return (
    <button type="button" className="menu-item" onClick={onClick}>
      {icon}
      <span>{children}</span>
    </button>
  );
}
