/** Classic 16-bytes-per-line dump: offset, hex (split at 8), ASCII. */
export function hexDump(u8: Uint8Array, from: number, to: number): string {
  const lines: string[] = [];
  for (let off = from; off < to; off += 16) {
    const row = u8.subarray(off, Math.min(off + 16, to));
    let hex = '';
    let asc = '';
    for (let j = 0; j < 16; j++) {
      hex += j < row.length ? row[j].toString(16).padStart(2, '0') + ' ' : '   ';
      if (j === 7) hex += ' ';
      if (j < row.length) asc += row[j] >= 32 && row[j] < 127 ? String.fromCharCode(row[j]) : '.';
    }
    lines.push(`${off.toString(16).padStart(8, '0')}  ${hex} ${asc}`);
  }
  return lines.join('\n');
}
