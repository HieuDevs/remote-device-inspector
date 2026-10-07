// Collapsible JSON tree (click ▸ to fold). Lines keep their indentation so a
// copied selection still reads as JSON; literals are shown exactly as sent.

import { memo, useState } from 'react';
import type { JsonNode } from '../lib/body/json';

const LEAF_CLASS = { s: 'j-str', n: 'j-num', b: 'j-bool', z: 'j-null' } as const;

interface NodeProps {
  n: JsonNode;
  path: string;
  ind: number;
  k: string | null;
  comma: string;
  isClosed(path: string): boolean;
  toggle(path: string): void;
}

const JNode = memo(function JNode({ n, path, ind, k, comma, isClosed, toggle }: NodeProps) {
  const pad = '  '.repeat(ind);
  const key = k ? (<><span className="j-key">{k}</span>: </>) : null;
  if (n.t !== 'o' && n.t !== 'a') {
    return <div className="jl">{pad}{key}<span className={LEAF_CLASS[n.t]}>{n.v}</span>{comma}</div>;
  }
  const [o, c] = n.t === 'a' ? ['[', ']'] : ['{', '}'];
  if (!n.e.length) return <div className="jl">{pad}{key}{o}{c}{comma}</div>;
  const closed = isClosed(path);
  return (
    <div className={`jn${closed ? ' closed' : ''}`}>
      <div className="jl">
        <span className="jt" onClick={() => toggle(path)} />
        {pad}{key}{o}
        <span className="j-sum"> {n.e.length} {n.t === 'a' ? 'items' : 'keys'} {c}{comma}</span>
      </div>
      {!closed && (
        <>
          <div className="jc">
            {n.e.map(([ck, v], i) => (
              <JNode key={i} n={v} path={`${path}/${i}`} ind={ind + 1} k={ck} comma={i < n.e.length - 1 ? ',' : ''} isClosed={isClosed} toggle={toggle} />
            ))}
          </div>
          <div className="jl jcl">{pad}{c}{comma}</div>
        </>
      )}
    </div>
  );
});

/** forceOpen: show everything (while searching, so no hit is hidden). */
export function JsonTree({ node, forceOpen = false }: { node: JsonNode; forceOpen?: boolean }) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const isClosed = (p: string) => !forceOpen && closed.has(p);
  const toggle = (p: string) =>
    setClosed((s) => {
      const next = new Set(s);
      if (!next.delete(p)) next.add(p);
      return next;
    });
  return <JNode n={node} path="" ind={0} k={null} comma="" isClosed={isClosed} toggle={toggle} />;
}
