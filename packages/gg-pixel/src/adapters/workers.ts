import { fingerprintWeb } from "../core/fingerprint-web.js";
import { parseBrowserStack } from "../core/stack-web.js";
import type { Level, WireEvent } from "../core/types.js";

/**
 * Cloudflare Workers / Vercel Edge / Bun edge adapter.
 *
 * These edge runtimes don't have `process.on(...)` (no Node) or `window.onerror`
 * (no DOM). Each request is an isolated invocation. The right pattern is to
 * **wrap the user's exported handler(s)** in a try/catch and `ctx.waitUntil`
 * the ingest POST so the runtime keeps I/O alive while the worker returns.
 *
 * We wrap every standard handler (fetch, scheduled, queue, email, trace) if
 * present on the user's exported handler object.
 */

interface WorkersExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface WorkersPixelOptions {
  projectKey: string;
  /** Backend ingest URL. Defaults to the public gg-pixel server. */
  ingestUrl?: string;
  /** Override the runtime label (default: `cloudflare-workers`). */
  runtime?: string;
}

const DEFAULT_INGEST_URL = "https://gg-pixel-server.buzzbeamaustralia.workers.dev";

const HANDLER_KEYS = ["fetch", "scheduled", "queue", "email", "trace"] as const;
type HandlerKey = (typeof HANDLER_KEYS)[number];
type AnyFn = (...args: unknown[]) => unknown;

/**
 * Wrap an exported Worker handler so any thrown error is reported to gg-pixel
 * before being re-thrown. Original error semantics are preserved.
 */
export function withPixel<H extends Partial<Record<HandlerKey, unknown>>>(
  options: WorkersPixelOptions,
  handler: H,
): H {
  const ingestUrl = buildIngestUrl(options.ingestUrl);
  const projectKey = options.projectKey;
  const runtime = options.runtime ?? "cloudflare-workers";

  const wrapped: Record<string, unknown> = { ...handler };
  for (const key of HANDLER_KEYS) {
    const original = handler[key];
    if (typeof original === "function") {
      wrapped[key] = wrapHandler(original as AnyFn, ingestUrl, projectKey, runtime);
    }
  }
  return wrapped as H;
}

function wrapHandler(fn: AnyFn, ingestUrl: string, projectKey: string, runtime: string): AnyFn {
  return async (...args: unknown[]) => {
    const ctx = args[args.length - 1] as WorkersExecutionContext | undefined;
    try {
      return await fn(...args);
    } catch (err) {
      try {
        const event = buildEvent(err, projectKey, runtime, false, "fatal");
        if (ctx && typeof ctx.waitUntil === "function") {
          ctx.waitUntil(sendEvent(ingestUrl, projectKey, event));
        } else {
          // No execution context (rare) — fire-and-forget without waitUntil.
          // The runtime may terminate before the request completes.
          void sendEvent(ingestUrl, projectKey, event).catch(() => {});
        }
      } catch {
        // never let pixel break the host program
      }
      throw err; // preserve original handler semantics
    }
  };
}

/**
 * Manual report from inside a Worker. The `ctx` is required so we can
 * `waitUntil` the ingest POST — without it the worker may terminate before
 * the network request completes.
 */
export function reportPixel(
  ctx: WorkersExecutionContext,
  options: WorkersPixelOptions,
  input: { message: string; error?: unknown; level?: Level },
): void {
  const ingestUrl = buildIngestUrl(options.ingestUrl);
  const runtime = options.runtime ?? "cloudflare-workers";
  const level = input.level ?? "error";
  let event: WireEvent;
  if (input.error !== undefined) {
    event = buildEvent(input.error, options.projectKey, runtime, true, level);
    if (input.message) event.message = input.message;
  } else {
    const err = new Error(input.message);
    err.name = "ManualReport";
    event = buildEvent(err, options.projectKey, runtime, true, level);
  }
  ctx.waitUntil(sendEvent(ingestUrl, options.projectKey, event));
}

function buildIngestUrl(base?: string): string {
  return (base ?? DEFAULT_INGEST_URL).replace(/\/+$/, "") + "/ingest";
}

function buildEvent(
  err: unknown,
  projectKey: string,
  runtime: string,
  manual: boolean,
  level: Level,
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
  if (typeof err === "string") return { type: "StringError", message: err };
  try {
    return { type: "UnknownError", message: JSON.stringify(err) };
  } catch {
    return { type: "UnknownError", message: String(err) };
  }
}

async function sendEvent(ingestUrl: string, projectKey: string, event: WireEvent): Promise<void> {
  try {
    await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pixel-key": projectKey,
      },
      body: JSON.stringify(event),
    });
  } catch {
    // best-effort
  }
}

function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback (workers always have crypto, but be defensive)
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
