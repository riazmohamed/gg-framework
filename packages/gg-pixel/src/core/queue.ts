import type { Sink, WireEvent } from "./types.js";

const MAX_BUFFER = 100;
const BASE_DELAY_MS = 200;
const MAX_DELAY_MS = 5_000;

export class EventQueue {
  private readonly buffer: WireEvent[] = [];
  private draining = false;
  private closed = false;

  constructor(private readonly sink: Sink) {}

  enqueue(event: WireEvent): void {
    if (this.closed) return;
    if (this.buffer.length >= MAX_BUFFER) {
      this.buffer.shift();
    }
    this.buffer.push(event);
    void this.drain();
  }

  enqueueSync(event: WireEvent): void {
    if (this.closed) return;
    if (this.sink.emitSync) {
      try {
        this.sink.emitSync(event);
        return;
      } catch {
        // fall through to async path
      }
    }
    this.enqueue(event);
  }

  async flush(): Promise<void> {
    while (this.buffer.length > 0 || this.draining) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  async close(): Promise<void> {
    await this.flush();
    this.closed = true;
    if (this.sink.close) await this.sink.close();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    let attempt = 0;
    while (this.buffer.length > 0) {
      const event = this.buffer[0];
      try {
        await this.sink.emit(event);
        this.buffer.shift();
        attempt = 0;
      } catch (err) {
        attempt++;
        if (attempt >= 5) {
          // Drop the event but make the loss observable — silent data loss
          // from the error tracker is the worst possible failure mode.
          console.warn(
            `[gg-pixel] dropping event after 5 failed deliveries: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          this.buffer.shift();
          attempt = 0;
          continue;
        }
        const delay = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    this.draining = false;
  }
}
