// H.264 Annex-B packets from the device, decoded with WebCodecs (hardware
// decoder, no JS codec) onto a canvas.
//   packet: u8 flags | u64 ptsUs | Annex-B data

const FLAG_CONFIG = 1;
const FLAG_KEY = 2;

// WebCodecs needs an RFC 6381 codec string: avc1.PPCCLL taken straight from
// the SPS NAL (profile_idc, constraint flags, level_idc).
function codecFromConfig(bytes: Uint8Array): string {
  for (let i = 0; i + 4 < bytes.length; i++) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1 && (bytes[i + 3] & 0x1f) === 7) {
      const hex = (b: number) => b.toString(16).padStart(2, '0');
      return `avc1.${hex(bytes[i + 4])}${hex(bytes[i + 5])}${hex(bytes[i + 6])}`;
    }
  }
  return 'avc1.42e01f';
}

export const webCodecsSupported = (): boolean => typeof VideoDecoder !== 'undefined';

export class VideoPipe {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private decoder: VideoDecoder | null = null;
  private config: Uint8Array | null = null; // SPS+PPS, prepended to every keyframe
  private waitingKey = true;
  /** frames drawn since the last read */
  frames = 0;

  /** Called when the decoder needs a fresh keyframe from the device. */
  constructor(private readonly requestKeyframe: () => void) {}

  attach(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    this.ctx = canvas?.getContext('2d') ?? null;
  }

  reset(): void {
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.decoder = null;
    this.config = null;
    this.waitingKey = true;
  }

  takeFrameCount(): number {
    const n = this.frames;
    this.frames = 0;
    return n;
  }

  push(buffer: ArrayBuffer): void {
    const view = new DataView(buffer);
    const flags = view.getUint8(0);
    const pts = Number(view.getBigUint64(1));
    const data = new Uint8Array(buffer, 9);

    if (flags & FLAG_CONFIG) {
      this.config = data.slice();
      this.createDecoder(codecFromConfig(this.config));
      this.waitingKey = true;
      return;
    }
    const decoder = this.decoder;
    if (!decoder || decoder.state !== 'configured' || !this.config) return;

    const isKey = (flags & FLAG_KEY) !== 0;
    // A decoder that falls behind adds latency; skip to the next keyframe.
    if (!isKey && decoder.decodeQueueSize > 8) {
      this.waitingKey = true;
      this.requestKeyframe();
    }
    if (this.waitingKey && !isKey) return;

    let chunk = data;
    if (isKey) {
      chunk = new Uint8Array(this.config.length + data.length);
      chunk.set(this.config, 0);
      chunk.set(data, this.config.length);
      this.waitingKey = false;
    }
    decoder.decode(new EncodedVideoChunk({ type: isKey ? 'key' : 'delta', timestamp: pts, data: chunk }));
  }

  private createDecoder(codec: string): void {
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.decoder = new VideoDecoder({
      output: (frame) => {
        const canvas = this.canvas;
        if (canvas && this.ctx) {
          if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
            canvas.width = frame.displayWidth;
            canvas.height = frame.displayHeight;
          }
          this.ctx.drawImage(frame, 0, 0);
        }
        frame.close();
        this.frames++;
      },
      error: (err) => {
        console.error('decoder error', err);
        this.waitingKey = true;
        this.requestKeyframe();
        if (this.config) this.createDecoder(codecFromConfig(this.config));
      },
    });
    // No `description` => the decoder expects Annex-B with in-band SPS/PPS.
    this.decoder.configure({ codec, optimizeForLatency: true, hardwareAcceleration: 'prefer-hardware' });
  }
}
