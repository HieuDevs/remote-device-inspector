import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

interface DragHandlers {
  /** body cursor while dragging */
  axis: 'col' | 'row';
  onMove(e: PointerEvent): void;
  onEnd?(): void;
}

/**
 * Pointer-captured drag for resize handles. Returns props for the handle and
 * whether it is being dragged (for the highlight class).
 */
export function useDrag({ axis, onMove, onEnd }: DragHandlers) {
  const handlers = useRef({ onMove, onEnd });
  handlers.current = { onMove, onEnd };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    document.body.classList.add(axis === 'col' ? 'resizing-col' : 'resizing-row');
    const move = (ev: PointerEvent) => handlers.current.onMove(ev);
    const end = () => {
      el.classList.remove('drag');
      document.body.classList.remove('resizing-col', 'resizing-row');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      handlers.current.onEnd?.();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };

  return { onPointerDown };
}
