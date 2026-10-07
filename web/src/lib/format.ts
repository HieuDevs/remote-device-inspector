export function fmtBytes(n: number | undefined): [string, string] {
  if (!n) return ['0', 'B'];
  if (n < 1024) return [`${n}`, 'B'];
  if (n < 1048576) return [(n / 1024).toFixed(1), 'KB'];
  return [(n / 1048576).toFixed(2), 'MB'];
}

export function bytesText(n: number | undefined): string {
  const [v, u] = fmtBytes(n);
  return n ? `${v} ${u}` : '·';
}

export const fmtClock = (ms: number): string => new Date(ms).toLocaleTimeString('en-GB', { hour12: false });

export const byteLen = (s: string | null | undefined): number => (s ? new TextEncoder().encode(s).length : 0);

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
