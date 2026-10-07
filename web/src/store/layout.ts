// Layout preferences, saved across reloads: where the DevTools panel docks,
// where the detail sits relative to the list, and the sizes the user dragged.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BodyKind, BodyView } from '../lib/body/analyze';

export type Pos = 'top' | 'bottom' | 'left' | 'right';
export const POSITIONS: Pos[] = ['top', 'bottom', 'left', 'right'];
/** left/right = a tall panel (sizes are widths); top/bottom = a band (heights) */
export const isSide = (p: Pos): boolean => p === 'left' || p === 'right';

/** The detail position is remembered per layout: a narrow side-docked panel
 *  defaults to detail-below, a wide one (band dock / debug mode) to detail-right. */
export type DetailCtx = 'side' | 'wide';

export interface Size {
  w: number;
  h: number;
}

interface LayoutState {
  dock: Pos;
  netOpen: boolean;
  /** panel width (side dock) / height (band dock), px */
  netSize: { side?: number; band?: number };
  detailPos: Record<DetailCtx, Pos>;
  /** detail height when stacked (col) / width when beside the list (row), px */
  detailSize: { col?: number; row?: number };
  /** headers column width in the Request / Response tabs, % */
  msgLeftPct: number | null;
  bodyView: Partial<Record<BodyKind, BodyView>>;
  modalSize: Record<string, Size>;

  setDock(p: Pos): void;
  setNetOpen(open: boolean): void;
  setNetSize(axis: 'side' | 'band', px: number): void;
  setDetailPos(ctx: DetailCtx, p: Pos): void;
  setDetailSize(axis: 'col' | 'row', px: number): void;
  setMsgLeftPct(pct: number | null): void;
  setBodyView(kind: BodyKind, view: BodyView): void;
  setModalSize(key: string, size: Size): void;
}

export const useLayout = create<LayoutState>()(
  persist(
    (set) => ({
      dock: 'right',
      netOpen: false,
      netSize: {},
      detailPos: { side: 'bottom', wide: 'right' },
      detailSize: {},
      msgLeftPct: null,
      bodyView: {},
      modalSize: {},

      setDock: (dock) => set({ dock }),
      setNetOpen: (netOpen) => set({ netOpen }),
      setNetSize: (axis, px) => set((s) => ({ netSize: { ...s.netSize, [axis]: px } })),
      setDetailPos: (ctx, p) => set((s) => ({ detailPos: { ...s.detailPos, [ctx]: p } })),
      setDetailSize: (axis, px) => set((s) => ({ detailSize: { ...s.detailSize, [axis]: px } })),
      setMsgLeftPct: (msgLeftPct) => set({ msgLeftPct }),
      setBodyView: (kind, view) => set((s) => ({ bodyView: { ...s.bodyView, [kind]: view } })),
      setModalSize: (key, size) => set((s) => ({ modalSize: { ...s.modalSize, [key]: size } })),
    }),
    { name: 'rdi-layout' },
  ),
);
