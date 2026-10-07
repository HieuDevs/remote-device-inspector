// Device wire format (both directions): u8 type | u32 BE length | payload.
// Must match Protocol.kt on the device.

export const T = {
  HELLO: 0x01, // device → relay  JSON {deviceId, model, sdk, control}
  SESSION: 0x02, // relay → device  JSON {code}
  HEARTBEAT: 0x03, // device → relay  JSON {control}
  VIDEO: 0x10, // device → relay  u8 flags | u64 ptsUs | H.264 Annex-B
  META: 0x11, // device → relay  JSON {width, height}
  CONTROL: 0x20, // relay → device  JSON (from viewer)
  VIEWERS: 0x21, // relay → device  JSON {count}
  KEYFRAME: 0x22, // relay → device  (empty) ask encoder for an IDR frame
  APILOG: 0x30, // device → relay  JSON network flow record
} as const;

export const FLAG_CONFIG = 1;
export const FLAG_KEY = 2;

export const MAX_FRAME = 8 * 1024 * 1024;

export function encodeFrame(type: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(5);
  header.writeUInt8(type, 0);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

/** Incremental parser: feed raw chunks, get whole frames back. Throws on a bad length. */
export class FrameParser {
  private buf: Buffer = Buffer.alloc(0);

  constructor(private readonly onFrame: (type: number, payload: Buffer) => void) {}

  feed(chunk: Buffer): void {
    let buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (buf.length >= 5) {
      const type = buf.readUInt8(0);
      const len = buf.readUInt32BE(1);
      if (len > MAX_FRAME) throw new Error(`frame too large: ${len}`);
      if (buf.length < 5 + len) break;
      const payload = buf.subarray(5, 5 + len);
      buf = buf.subarray(5 + len);
      this.onFrame(type, payload);
    }
    this.buf = buf;
  }
}
