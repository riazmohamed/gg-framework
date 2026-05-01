import { parseBrowserStack } from "../core/stack-web.js";
import { fingerprintWeb } from "../core/fingerprint-web.js";
import { EventQueue } from "../core/queue.js";
import type { Level, ReportInput, Sink, WireEvent } from "../core/types.js";

declare global {
  interface Window {
    onerror:
      | ((
          message: string | Event,
          source?: string,
          lineno?: number,
          colno?: number,
          error?: Error,
        ) => boolean | void)
      | null;
    onunhandledrejection: ((event: PromiseRejectionEvent) => boolean | void) | null;
  }
}

export interface BrowserAdapterOptions {
  projectKey: string;
  runtime: string;
  sink: Sink;
  captureConsoleErrors: boolean;
  captureConsoleWarnings: boolean;
  captureUnhandledRejections: boolean;
  captureUncaughtExceptions: boolean;
}

export interface BrowserAdapter {
  report(input: ReportInput): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Wire global browser error handlers.
 *
 * Patterned after Sentry's `globalError.ts` / `globalUnhandledRejection.ts`:
 * we patch `window.onerror` / `window.onunhandledrejection` (the property,
 * not addEventListener) so that errors fired before our listener registered
 * — e.g. via a deferred loader — are still observed. Any previous handler
 * is preserved and called after we capture.
 */
export function installBrowserAdapter(opts: BrowserAdapterOptions): BrowserAdapter {
  const queue = new EventQueue(opts.sink);
  const detach: Array<() => void> = [];

  const enqueueError = (err: unknown, level: Level, manual: boolean) => {
    try {
      const event = buildEvent(err, level, manual, opts.projectKey, opts.runtime);
      queue.enqueue(event);
    } catch {
      // never let pixel break the host program
    }
  };

  if (opts.captureUncaughtExceptions) {
    const previous = window.onerror;
    const handler: typeof window.onerror = (message, source, lineno, colno, error) => {
      // Cross-origin script errors give us no useful info. Bugsnag's filter:
      // `lineno === 0` plus a "Script error." message is the canonical signal.
      const msgStr = typeof message === "string" ? message : "";
      if (lineno === 0 && /^Script error\.?$/i.test(msgStr)) {
        return previous ? previous.call(window, message, source, lineno, colno, error) : false;
      }
      // Prefer the actual Error object if present (modern browsers pass it
      // as the 5th arg). Fall back to constructing one from the message.
      if (error instanceof Error) {
        enqueueError(error, "error", false);
      } else if (msgStr) {
        const synthetic = new Error(msgStr);
        if (source) synthetic.stack = `${msgStr}\n    at ${source}:${lineno ?? 0}:${colno ?? 0}`;
        enqueueError(synthetic, "error", false);
      }
      return previous ? previous.call(window, message, source, lineno, colno, error) : false;
    };
    window.onerror = handler;
    detach.push(() => {
      if (window.onerror === handler) window.onerror = previous;
    });
  }

  if (opts.captureUnhandledRejections) {
    const previous = window.onunhandledrejection;
    const handler: typeof window.onunhandledrejection = (event) => {
      const reason = (event as PromiseRejectionEvent).reason;
      enqueueError(reason, "error", false);
      if (previous) return previous.call(window, event);
      return undefined;
    };
    window.onunhandledrejection = handler;
    detach.push(() => {
      if (window.onunhandledrejection === handler) window.onunhandledrejection = previous;
    });
  }

  if (opts.captureConsoleErrors) {
    detach.push(patchConsole("error", (args) => enqueueError(consoleError(args), "error", false)));
  }

  if (opts.captureConsoleWarnings) {
    detach.push(patchConsole("warn", (args) => enqueueError(consoleError(args), "warning", false)));
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
          // never let pixel break the host program
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
  const sameOrigin = typeof window !== "undefined" ? window.location.origin : undefined;
  const stack = parseBrowserStack(stackString, sameOrigin);
  return {
    event_id: uuid(),
    project_key: projectKey,
    fingerprint: fingerprintWeb(type, stack),
    type,
    message,
    stack,
    code_context: null, // browsers can't read source files synchronously
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

function consoleError(args: unknown[]): unknown {
  for (const a of args) if (a instanceof Error) return a;
  return new Error(args.map(stringify).join(" "));
}

function stringify(x: unknown): string {
  if (typeof x === "string") return x;
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

type ConsoleMethod = "error" | "warn";

function patchConsole(method: ConsoleMethod, onCall: (args: unknown[]) => void): () => void {
  const original = console[method];
  console[method] = (...args: unknown[]) => {
    try {
      onCall(args);
    } catch {
      // never let pixel break the host program
    }
    original.apply(console, args);
  };
  return () => {
    console[method] = original;
  };
}

/**
 * RFC4122 v4 UUID using `crypto.randomUUID()` when available,
 * falling back to `crypto.getRandomValues()`-based generation.
 */
function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback: build manually from 16 random bytes.
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
