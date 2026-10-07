// In-body search highlighting with the CSS Custom Highlight API: hits are
// Ranges painted by `::highlight(...)`, so React-owned DOM is never mutated.
// Each viewer registers its own ranges; all are merged into two highlights.

interface Hits {
  ranges: Range[];
  active: Range | null;
}

const owners = new Map<object, Hits>();
const supported = typeof CSS !== 'undefined' && 'highlights' in CSS;

function sync(): void {
  if (!supported) return;
  const all: Range[] = [];
  const active: Range[] = [];
  for (const h of owners.values()) {
    all.push(...h.ranges);
    if (h.active) active.push(h.active);
  }
  CSS.highlights.set('body-hit', new Highlight(...all));
  CSS.highlights.set('body-hit-active', new Highlight(...active));
}

export function setHits(owner: object, ranges: Range[], active: Range | null): void {
  owners.set(owner, { ranges, active });
  sync();
}

export function clearHits(owner: object): void {
  if (owners.delete(owner)) sync();
}

/** Case-insensitive matches of q inside root's text nodes. */
export function findRanges(root: Node, q: string): Range[] {
  const needle = q.toLowerCase();
  const out: Range[] = [];
  if (!needle) return out;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const lower = (node.nodeValue || '').toLowerCase();
    for (let idx = lower.indexOf(needle); idx !== -1; idx = lower.indexOf(needle, idx + needle.length)) {
      const r = document.createRange();
      r.setStart(node, idx);
      r.setEnd(node, idx + needle.length);
      out.push(r);
    }
  }
  return out;
}

export function scrollRangeIntoView(r: Range): void {
  const el = r.startContainer.parentElement;
  el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
