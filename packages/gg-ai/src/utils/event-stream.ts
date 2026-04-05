import type { StreamEvent, StreamResponse } from "../types.js";

/**
 * Push-based async iterable. Producers push events, consumers
 * iterate with `for await`. Also supports thenable so you can
 * `await stream(...)` directly to get the final response.
 */
export class EventStream<T = StreamEvent> implements AsyncIterable<T> {
  private queue: T[] = [];
  private resolve: (() => void) | null = null;
  private done = false;
  private error: Error | null = null;

  push(event: T): void {
    // Safety valve: if queue grows beyond 10k unconsumed events, drop oldest
    // to prevent OOM when consumer is blocked/slow
    if (this.queue.length > 10_000) {
      this.queue.splice(0, this.queue.length - 5_000);
    }
    this.queue.push(event);
    this.resolve?.();
    this.resolve = null;
  }

  close(): void {
    this.done = true;
    this.resolve?.();
    this.resolve = null;
  }

  abort(error: Error): void {
    this.error = error;
    this.done = true;
    this.resolve?.();
    this.resolve = null;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    let index = 0;
    while (true) {
      while (index < this.queue.length) {
        yield this.queue[index++]!;
      }
      // Reset to avoid holding references to already-yielded events
      this.queue.splice(0, index);
      index = 0;
      if (this.error) throw this.error;
      if (this.done) return;
      await new Promise<void>((r) => {
        this.resolve = r;
      });
    }
  }
}

/**
 * Pull-based stream result. Wraps an async generator that yields
 * StreamEvents and returns a StreamResponse. Also thenable so:
 *
 *   const msg = await stream({...})          // awaits response
 *   for await (const e of stream({...})) {}  // iterates events
 *
 * The generator is pumped eagerly — events flow into an internal
 * buffer regardless of whether a consumer is iterating. This avoids
 * the push-based EventStream's stall bugs (lost wakeups, single
 * resolve field, iterator starvation).
 */
export class StreamResult implements AsyncIterable<StreamEvent> {
  readonly response: Promise<StreamResponse>;
  private buffer: StreamEvent[] = [];
  private done = false;
  private error: Error | null = null;
  private resolveResponse!: (r: StreamResponse) => void;
  private rejectResponse!: (e: Error) => void;
  private resolveWait: (() => void) | null = null;

  constructor(generator: AsyncGenerator<StreamEvent, StreamResponse>) {
    this.response = new Promise<StreamResponse>((resolve, reject) => {
      this.resolveResponse = resolve;
      this.rejectResponse = reject;
    });
    this.pump(generator);
  }

  private async pump(generator: AsyncGenerator<StreamEvent, StreamResponse>): Promise<void> {
    try {
      let next = await generator.next();
      while (!next.done) {
        this.buffer.push(next.value);
        this.resolveWait?.();
        this.resolveWait = null;
        next = await generator.next();
      }
      this.done = true;
      this.resolveResponse(next.value);
      this.resolveWait?.();
      this.resolveWait = null;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.error = error;
      this.done = true;
      this.rejectResponse(error);
      this.resolveWait?.();
      this.resolveWait = null;
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
    let index = 0;
    while (true) {
      while (index < this.buffer.length) {
        yield this.buffer[index++]!;
      }
      if (this.error) throw this.error;
      if (this.done) return;
      await new Promise<void>((r) => {
        this.resolveWait = r;
        // Guard against race: pump may have advanced between the while-check
        // and this promise registration. Re-check and resolve immediately.
        if (this.buffer.length > index || this.done || this.error) {
          this.resolveWait = null;
          r();
        }
      });
    }
  }

  then<TResult1 = StreamResponse, TResult2 = never>(
    onfulfilled?: ((value: StreamResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.response.then(onfulfilled, onrejected);
  }
}
