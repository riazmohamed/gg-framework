import { parseBrowserStack } from "../core/stack-web.js";
import { fingerprintWeb } from "../core/fingerprint-web.js";
import { EventQueue } from "../core/queue.js";
import type { Level, ReportInput, Sink, WireEvent } from "../core/types.js";

/**
 * Deno adapter.
 *
 * Deno fires `error` and `unhandledrejection` events on `globalThis`
 * (the same Web events the browser uses), but doesn't have `window` or
 * `navigator`. We can hook them via `globalThis.addEventListener`.
 *
 * Deno's `error` event fires for uncaught synchronous errors. By default
 * Deno also exits the process; we capture sync via the `Sink.emitSync`
 * if the sink supports it, otherwise enqueue and hope.
 */

export interface DenoAdapterOptions {
  projectKey: string;
  runtime: string;
  sink: Sink;
  captureUnhandledRejections: boolean;
  captureUncaughtExceptions: boolean;
}

export interface DenoAdapter {
  report(input: ReportInput): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export function installDenoAdapter(opts: DenoAdapterOptions): DenoAdapter {
  const queue = new EventQueue(opts.sink);
  const detach: Array<() => void> = [];

  const enqueueError = (err: unknown, level: Level, manual: boolean) => {
    try {
      const event = buildEvent(err, level, manual, opts.projectKey, opts.runtime);
      queue.enqueue(event);
    } catch {
      // never break the host
    }
  };

  if (opts.captureUncaughtExceptions) {
    const handler = (e: Event) => {
      const errorEvent = e as ErrorEvent;
      const err = errorEvent.error ?? errorEvent.message ?? "unknown error";
      enqueueError(err, "fatal", false);
    };
    globalThis.addEventListener("error", handler);
    detach.push(() => globalThis.removeEventListener("error", handler));
  }

  if (opts.captureUnhandledRejections) {
    const handler = (e: Event) => {
      const ev = e as PromiseRejectionEvent;
      enqueueError(ev.reason, "error", false);
    };
    globalThis.addEventListener("unhandledrejection", handler);
    detach.push(() => globalThis.removeEventListener("unhandledrejection", handler));
  }

  return {
    report(input: ReportInput) {
      const level = input.level ?? "error";
      if (input.error !== undefined) {
        try {
          const event = buildEvent(input.error, level, true, opts.projectKey, opts.runtime);
          if (input.message) event.message = input.message;
          queue.enqueue(event);
        } catch {
          // never break the host
        }
        return;
      }
      const err = new Error(input.message);
      err.name = "ManualReport";
      enqueueError(err, level, true);
    },
    flush: () => queue.flush(),
    close: async () => {
      for (const fn of detach) fn();
      await queue.close();
    },
  };
}

function buildEvent(
  err: unknown,
  level: Level,
  manual: boolean,
  projectKey: string,
  runtime: string,
): WireEvent {
  const { type, message, stackString } = normalize(err);
  const stack = parseBrowserStack(stackString);
  return {
    event_id: uuid(),
    project_key: projectKey,
    fingerprint: fingerprintWeb(type, stack),
    type,
    message,
    stack,
    code_context: null,
    runtime,
    manual_report: manual,
    level,
    occurred_at: new Date().toISOString(),
  };
}

function normalize(err: unknown): { type: string; message: string; stackString?: string } {
  if (err instanceof Error) {
    return { type: err.name || "Error", message: err.message, stackString: err.stack };
  }
  if (typeof err === "string") {
    return { type: "StringError", message: err };
  }
  try {
    return { type: "UnknownError", message: JSON.stringify(err) };
  } catch {
    return { type: "UnknownError", message: String(err) };
  }
}

function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
