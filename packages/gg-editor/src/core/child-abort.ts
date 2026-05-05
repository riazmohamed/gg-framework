/**
 * Shared abort wiring for spawned child processes.
 *
 * Every long-running tool in gg-editor — ffmpeg, whisper.cpp, whisperx,
 * Python sidecars (librosa beats, MediaPipe face reframe), Resolve bridge —
 * is wrapped in a Promise that resolves on `child.on("close")`. Without
 * careful abort handling those promises can hang for the duration of the
 * child's actual exit even after the user pressed ESC.
 *
 * The naive pattern `signal.addEventListener("abort", () => child.kill())`
 * has three real failure modes:
 *
 *   1. **Pre-abort race** — if `signal.aborted` is already true at attach
 *      time, the listener never fires (Node only dispatches `abort` once,
 *      at the moment the controller flips). The child runs to completion.
 *
 *   2. **SIGTERM ignored** — CPU-bound inference (whisper.cpp processing a
 *      30-min audio chunk, ffmpeg encoding a long video) can ignore
 *      SIGTERM until it finishes the current loop iteration. Users press
 *      ESC and watch nothing happen for many seconds.
 *
 *   3. **Promise waits for close** — even if the kill works, the outer
 *      Promise resolves on `child.on("close")`, which fires AFTER the
 *      child finishes dying. The agent loop sees the abort late.
 *
 * `wireChildAbort` fixes all three:
 *
 *   - Synchronous pre-aborted check → kills + rejects immediately.
 *   - SIGTERM, then SIGKILL after a configurable grace period (default 1.5s).
 *   - Caller decides whether to reject early (most callers pass `onAbort`
 *     that rejects with an `AbortError`); resolves can still happen
 *     naturally on close if the caller prefers a "code: SIGTERM" outcome.
 *   - Returns a cleanup function that removes the listener and clears the
 *     SIGKILL timer. Caller must invoke once the promise settles.
 */

import type { ChildProcess } from "node:child_process";

/**
 * Standard AbortError. Mirrors what `fetch` raises when its signal fires —
 * `name === "AbortError"` is the cross-platform contract for cancellation.
 */
export function abortError(message = "aborted"): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException(message, "AbortError");
  }
  const e = new Error(message);
  e.name = "AbortError";
  return e;
}

export interface WireChildAbortOptions {
  /** Optional. Called on abort BEFORE the SIGKILL grace period. Use to reject the wrapping Promise immediately. */
  onAbort?: () => void;
  /** Grace period before escalating to SIGKILL. Default 1500 ms. */
  killAfterMs?: number;
}

/**
 * Wire an AbortSignal to a child process. See file header for design rationale.
 *
 * Returns a cleanup function the caller MUST invoke once the promise settles
 * (in both `child.on("close")` and `child.on("error")`). Without cleanup the
 * abort listener stays on the signal and the SIGKILL timer keeps a process
 * reference alive.
 */
export function wireChildAbort(
  signal: AbortSignal | undefined,
  child: ChildProcess,
  opts: WireChildAbortOptions = {},
): () => void {
  if (!signal) return () => {};

  const killAfterMs = opts.killAfterMs ?? 1500;
  let killTimer: NodeJS.Timeout | undefined;
  let fired = false;

  const onAbort = () => {
    if (fired) return;
    fired = true;
    try {
      child.kill("SIGTERM");
    } catch {
      // child may already be dead — fine.
    }
    killTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ditto
      }
    }, killAfterMs);
    opts.onAbort?.();
  };

  if (signal.aborted) {
    // Pre-aborted — fire synchronously so caller's onAbort runs in the same tick.
    onAbort();
  } else {
    signal.addEventListener("abort", onAbort, { once: true });
  }

  return () => {
    signal.removeEventListener("abort", onAbort);
    if (killTimer) clearTimeout(killTimer);
  };
}
