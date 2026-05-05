import type { BossEvent } from "./types.js";

/**
 * Single-consumer queue with user-preempt semantics:
 * user_message events jump ahead of worker events but stay FIFO among themselves.
 * Worker events stay FIFO among themselves.
 */
export class EventQueue {
  private user: BossEvent[] = [];
  private rest: BossEvent[] = [];
  private waiters: Array<(e: BossEvent) => void> = [];

  push(event: BossEvent): void {
    if (event.kind === "user_message") this.user.push(event);
    else this.rest.push(event);
    this.deliverIfWaiting();
  }

  private deliverIfWaiting(): void {
    if (this.waiters.length === 0) return;
    const next = this.user.shift() ?? this.rest.shift();
    if (!next) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter(next);
  }

  next(): Promise<BossEvent> {
    const ready = this.user.shift() ?? this.rest.shift();
    if (ready) return Promise.resolve(ready);
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  size(): number {
    return this.user.length + this.rest.length;
  }
}
