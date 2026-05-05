import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { abortError, wireChildAbort } from "./child-abort.js";

describe("abortError", () => {
  it("returns an error with name 'AbortError'", () => {
    const e = abortError();
    expect(e.name).toBe("AbortError");
  });

  it("accepts a custom message", () => {
    expect(abortError("custom").message).toContain("custom");
  });
});

/**
 * Use a child that sleeps long enough that SIGTERM-then-SIGKILL is observable
 * but short enough that test runs stay fast. Node spawned with `-e` running a
 * setTimeout works on every platform CI uses.
 */
function spawnSleeper(seconds: number) {
  return spawn(process.execPath, ["-e", `setTimeout(() => {}, ${seconds * 1000})`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("wireChildAbort", () => {
  it("is a no-op when signal is undefined", () => {
    const child = spawnSleeper(0.1);
    const cleanup = wireChildAbort(undefined, child);
    expect(typeof cleanup).toBe("function");
    cleanup(); // shouldn't throw
    child.kill();
  });

  it("kills the child with SIGTERM when the signal aborts", async () => {
    const ac = new AbortController();
    const child = spawnSleeper(10);
    const killSpy = vi.spyOn(child, "kill");
    const cleanup = wireChildAbort(ac.signal, child);

    ac.abort();
    expect(killSpy).toHaveBeenCalledWith("SIGTERM");

    // Wait for child to actually exit so the test runner doesn't leak.
    await new Promise<void>((resolve) => child.on("close", () => resolve()));
    cleanup();
  });

  it("fires onAbort exactly once even on repeated aborts", () => {
    const ac = new AbortController();
    const child = spawnSleeper(10);
    const onAbort = vi.fn();
    wireChildAbort(ac.signal, child, { onAbort });

    ac.abort();
    ac.abort(); // duplicate signal — listener attached `once`
    expect(onAbort).toHaveBeenCalledTimes(1);
    child.kill("SIGKILL");
  });

  it("fires synchronously when the signal is already aborted at attach time", () => {
    const ac = new AbortController();
    ac.abort(); // pre-abort

    const child = spawnSleeper(10);
    const killSpy = vi.spyOn(child, "kill");
    const onAbort = vi.fn();
    wireChildAbort(ac.signal, child, { onAbort });

    expect(killSpy).toHaveBeenCalledWith("SIGTERM");
    expect(onAbort).toHaveBeenCalledTimes(1);
    child.kill("SIGKILL");
  });

  it("cleanup removes the listener (no further onAbort after cleanup)", () => {
    const ac = new AbortController();
    const child = spawnSleeper(10);
    const onAbort = vi.fn();
    const cleanup = wireChildAbort(ac.signal, child, { onAbort });

    cleanup();
    ac.abort();
    expect(onAbort).not.toHaveBeenCalled();
    child.kill("SIGKILL");
  });

  it("escalates to SIGKILL after the grace period when SIGTERM is ignored", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const child = spawnSleeper(10);
    const killSpy = vi.spyOn(child, "kill");
    wireChildAbort(ac.signal, child, { killAfterMs: 50 });

    ac.abort();
    expect(killSpy).toHaveBeenLastCalledWith("SIGTERM");

    vi.advanceTimersByTime(60);
    expect(killSpy).toHaveBeenLastCalledWith("SIGKILL");

    vi.useRealTimers();
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => child.on("close", () => resolve()));
  });
});
