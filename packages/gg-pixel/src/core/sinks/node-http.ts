import { spawnSync } from "node:child_process";
import { HttpSink } from "./http.js";
import type { WireEvent } from "../types.js";

/**
 * Node-only HTTP sink that adds a synchronous `emitSync` path for fatal
 * events.
 *
 * Why: when `uncaughtExceptionMonitor` fires, Node tears the process down
 * before any pending async work can complete — meaning a normal `fetch()` to
 * the ingest endpoint loses the most important event (the fatal one).
 * Sentry's Node SDK solves this for serverless environments by spawning
 * an external HTTP client synchronously. We do the same with `curl`, which
 * ships with macOS, every modern Linux distro, and Windows 10 1803+.
 *
 * Tradeoff: ~100ms latency per fatal event (curl process spin-up). Fatal
 * events are rare so this is acceptable. Pending non-fatal events still in
 * the async queue at crash time may be lost — flushing them sync would
 * block the fatal handler for seconds in the worst case.
 */
export class NodeHttpSink extends HttpSink {
  constructor(
    private readonly url: string,
    fetchFn?: typeof fetch,
  ) {
    super(url, fetchFn);
  }

  emitSync(event: WireEvent): void {
    const body = JSON.stringify(event);
    const result = spawnSync(
      "curl",
      [
        "--silent",
        "--show-error",
        "-X",
        "POST",
        "-H",
        "content-type: application/json",
        "-H",
        `x-pixel-key: ${event.project_key}`,
        "--data-binary",
        "@-",
        "--max-time",
        "3",
        this.url,
      ],
      { input: body, encoding: "utf8" },
    );
    if (result.error || result.status !== 0) {
      // Best-effort. We're already in a fatal handler; can't retry async.
      console.warn(
        `[gg-pixel] sync emit failed: ${result.error?.message ?? result.stderr ?? "unknown"}`,
      );
    }
  }
}
