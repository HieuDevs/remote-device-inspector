import { POSITIONS, type Pos } from '../store/layout';

const ARROW: Record<Pos, string> = { top: '↑', bottom: '↓', left: '←', right: '→' };

interface Props {
  title: string;
  value: Pos;
  titles: Record<Pos, string>;
  onChange(p: Pos): void;
}

/** 4-way position picker (panel dock, detail position), in the panel's ⋯ menu. */
export function PosPicker({ title, value, titles, onChange }: Props) {
  return (
    <div className="pos-pick" title={title}>
      {POSITIONS.map((p) => (
        <button key={p} type="button" className={p === value ? 'on' : ''} title={titles[p]} onClick={() => onChange(p)}>
          {ARROW[p]}
        </button>
      ))}
    </div>
  );
}
