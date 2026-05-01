import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLazyHost } from "./lazy.js";

/**
 * The lazy host has two responsibilities:
 *   1. Re-detect the running NLE on demand (so opening Resolve mid-session
 *      is picked up without a CLI restart).
 *   2. Preserve the optional-method semantics existing tools rely on:
 *      `if (host.openPage)` must reflect the LIVE adapter, not the one we
 *      had at construction.
 *
 * We test these without booting Resolve / Premiere by stubbing the
 * detectHost module.
 */

let mockDetected: { name: "resolve" | "premiere" | "none" } = { name: "none" };

vi.mock("./detect.js", () => ({
  detectHost: () => ({
    name: mockDetected.name,
    displayName:
      mockDetected.name === "resolve"
        ? "DaVinci Resolve"
        : mockDetected.name === "premiere"
          ? "Adobe Premiere Pro"
          : "No NLE detected",
    matched: [],
  }),
}));

beforeEach(() => {
  mockDetected = { name: "none" };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createLazyHost — name reflects the live adapter", () => {
  it("starts as 'none' when nothing is detected", () => {
    const host = createLazyHost({ redetectIntervalMs: 0 });
    expect(host.name).toBe("none");
    host.shutdown();
  });

  it("flips to 'resolve' after Resolve appears, with cache invalidation", () => {
    const host = createLazyHost({ redetectIntervalMs: 0 });
    expect(host.name).toBe("none");
    mockDetected = { name: "resolve" };
    expect(host.name).toBe("resolve");
    expect(host.displayName).toBe("DaVinci Resolve");
    host.shutdown();
  });

  it("respects redetectIntervalMs cache (won't see new host until interval elapses)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    const host = createLazyHost({ redetectIntervalMs: 5000 });
    expect(host.name).toBe("none");

    mockDetected = { name: "resolve" };
    // Same tick — cache returns the original adapter.
    expect(host.name).toBe("none");

    // Advance past interval — re-detects.
    vi.setSystemTime(new Date(6000));
    expect(host.name).toBe("resolve");
    host.shutdown();
  });
});

describe("createLazyHost — optional-method getters", () => {
  // The getter contract: return whatever the live adapter exposes, bound
  // so `this` resolves correctly. NoneAdapter defines every optional
  // method (they throw HostUnreachableError on call) — so the lazy host's
  // getters return functions, not undefined, in the host=none case. The
  // tools that probe `if (host.openPage)` rely on this faithful forwarding
  // (the `force-strip` tests in new-tools.test simulate adapters that
  // genuinely omit a method).

  it("openPage forwards a callable from the live adapter", () => {
    const host = createLazyHost({ redetectIntervalMs: 0 });
    expect(typeof host.openPage).toBe("function");
    mockDetected = { name: "resolve" };
    expect(typeof host.openPage).toBe("function");
    host.shutdown();
  });

  it("the bound openPage rejects with HostUnreachableError when host=none", async () => {
    const host = createLazyHost({ redetectIntervalMs: 0 });
    const fn = host.openPage;
    expect(fn).toBeDefined();
    await expect(fn!("color")).rejects.toThrow(/No NLE attached/);
    host.shutdown();
  });

  it("smartReframe forwards a callable from the live adapter", () => {
    const host = createLazyHost({ redetectIntervalMs: 0 });
    expect(typeof host.smartReframe).toBe("function");
    host.shutdown();
  });

  it("setClipVolume forwards a callable from the live adapter", () => {
    const host = createLazyHost({ redetectIntervalMs: 0 });
    expect(typeof host.setClipVolume).toBe("function");
    host.shutdown();
  });
});

describe("createLazyHost — forced mode", () => {
  it("never re-detects when forced", () => {
    const host = createLazyHost({ forced: "none", redetectIntervalMs: 0 });
    expect(host.name).toBe("none");
    mockDetected = { name: "resolve" };
    // Forced means we ignore detection entirely.
    expect(host.name).toBe("none");
    host.shutdown();
  });
});

describe("createLazyHost — invalidate()", () => {
  it("forces a fresh detection on the next access", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    const host = createLazyHost({ redetectIntervalMs: 60_000 });
    expect(host.name).toBe("none");

    mockDetected = { name: "resolve" };
    // Within cache window — still returns 'none'.
    expect(host.name).toBe("none");

    host.invalidate();
    expect(host.name).toBe("resolve");
    host.shutdown();
  });
});
