import { installDenoAdapter, type DenoAdapter } from "./adapters/deno.js";
import { HttpSink } from "./core/sinks/http.js";
import type { Sink } from "./core/types.js";

export const DEFAULT_INGEST_URL = "https://gg-pixel-server.buzzbeamaustralia.workers.dev";

export interface DenoPixelOptions {
  projectKey: string;
  ingestUrl?: string;
  runtime?: string;
  sink?: Sink;
  captureUnhandledRejections?: boolean;
  captureUncaughtExceptions?: boolean;
}

let active: DenoAdapter | null = null;

export function initPixel(options: DenoPixelOptions): DenoAdapter {
  if (active) {
    throw new Error("gg-pixel is already initialized; call closePixel() first");
  }
  const sink: Sink = options.sink ?? new HttpSink(buildIngestUrl(options.ingestUrl));
  active = installDenoAdapter({
    projectKey: options.projectKey,
    runtime: options.runtime ?? defaultRuntime(),
    sink,
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
  // Deno exposes its version on `Deno.version.deno`. Cast through unknown
  // because TypeScript doesn't see `Deno` in standard lib types.
  const d = (globalThis as { Deno?: { version?: { deno?: string } } }).Deno;
  return d?.version?.deno ? `deno-${d.version.deno}` : "deno";
}

export type { Level, ReportInput, StackFrame, WireEvent } from "./core/types.js";
