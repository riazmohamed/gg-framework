import { installBrowserAdapter, type BrowserAdapter } from "./adapters/browser.js";
import { HttpSink } from "./core/sinks/http.js";
import type { Sink } from "./core/types.js";

export const DEFAULT_INGEST_URL = "https://gg-pixel-server.buzzbeamaustralia.workers.dev";

export interface BrowserPixelOptions {
  projectKey: string;
  /** Backend ingest URL. Defaults to the public gg-pixel server. */
  ingestUrl?: string;
  /** Override the runtime label. Default: `browser-<UA short>`. */
  runtime?: string;
  /** Inject a custom sink — overrides ingestUrl. */
  sink?: Sink;
  captureConsoleErrors?: boolean;
  captureConsoleWarnings?: boolean;
  captureUnhandledRejections?: boolean;
  captureUncaughtExceptions?: boolean;
}

let active: BrowserAdapter | null = null;

export function initPixel(options: BrowserPixelOptions): BrowserAdapter {
  if (active) {
    throw new Error("gg-pixel is already initialized; call closePixel() first");
  }
  const sink: Sink = options.sink ?? new HttpSink(buildIngestUrl(options.ingestUrl));
  active = installBrowserAdapter({
    projectKey: options.projectKey,
    runtime: options.runtime ?? defaultRuntime(),
    sink,
    captureConsoleErrors: options.captureConsoleErrors ?? false,
    captureConsoleWarnings: options.captureConsoleWarnings ?? false,
    captureUnhandledRejections: options.captureUnhandledRejections ?? true,
    captureUncaughtExceptions: options.captureUncaughtExceptions ?? true,
  });
  return active;
}

export function reportPixel(input: {
  message: string;
  error?: unknown;
  level?: "error" | "warning" | "fatal";
}): void {
  if (!active) return;
  active.report(input);
}

export async function flushPixel(): Promise<void> {
  if (!active) return;
  await active.flush();
}

export async function closePixel(): Promise<void> {
  if (!active) return;
  await active.close();
  active = null;
}

function buildIngestUrl(base?: string): string {
  const url = (base ?? DEFAULT_INGEST_URL).replace(/\/+$/, "");
  return `${url}/ingest`;
}

function defaultRuntime(): string {
  if (typeof navigator === "undefined") return "browser-unknown";
  const ua = navigator.userAgent;
  if (/Chrome\/(\d+)/.test(ua)) return `chrome-${RegExp.$1}`;
  if (/Firefox\/(\d+)/.test(ua)) return `firefox-${RegExp.$1}`;
  if (/Version\/(\d+).*Safari/.test(ua)) return `safari-${RegExp.$1}`;
  if (/Edg\/(\d+)/.test(ua)) return `edge-${RegExp.$1}`;
  return "browser";
}

export type { Level, ReportInput, StackFrame, WireEvent } from "./core/types.js";
