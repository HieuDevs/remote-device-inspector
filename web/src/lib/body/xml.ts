// Small XML/SVG indenter: tags on their own lines, short text kept inline.
export function prettyXml(src: string): string {
  const tokens = src
    .replace(/>\s+</g, '><')
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<[^>]+>)/)
    .filter((t) => t.trim() !== '');
  const out: string[] = [];
  let ind = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const pad = '  '.repeat(ind);
    if (t.startsWith('</')) {
      ind = Math.max(0, ind - 1);
      out.push('  '.repeat(ind) + t);
      continue;
    }
    const opening = /^<[A-Za-z_][^>]*>$/.test(t) && !t.endsWith('/>');
    const next = tokens[i + 1];
    if (opening && next != null && !next.startsWith('<') && tokens[i + 2]?.startsWith('</')) {
      out.push(pad + t + next.trim() + tokens[i + 2]);
      i += 2;
      continue;
    }
    if (opening && next?.startsWith('</')) {
      out.push(pad + t + next);
      i++;
      continue;
    }
    out.push(pad + t.trim());
    if (opening) ind++;
  }
  return out.join('\n');
}
