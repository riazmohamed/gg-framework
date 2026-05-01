import { describe, it, expect } from "vitest";
import { HttpSink } from "./http.js";
import type { WireEvent } from "../types.js";

const evt: WireEvent = {
  event_id: "evt_test",
  project_key: "pk_test",
  fingerprint: "fp",
  type: "TypeError",
  message: "boom",
  stack: [],
  code_context: null,
  runtime: "node-22",
  manual_report: false,
  level: "error",
  occurred_at: "2026-04-29T00:00:00Z",
};

describe("HttpSink", () => {
  it("POSTs to the ingest URL with the project_key header and JSON body", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const sink = new HttpSink("https://example.com/ingest", fakeFetch);
    await sink.emit(evt);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://example.com/ingest");
    expect(call.init.method).toBe("POST");
    const headers = call.init.headers as Record<string, string>;
    expect(headers["x-pixel-key"]).toBe("pk_test");
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(String(call.init.body))).toMatchObject({
      event_id: "evt_test",
      fingerprint: "fp",
    });
  });

  it("throws on non-2xx so the queue retries", async () => {
    const fakeFetch = (async () =>
      new Response("oops", { status: 500 })) as unknown as typeof fetch;
    const sink = new HttpSink("https://example.com/ingest", fakeFetch);
    await expect(sink.emit(evt)).rejects.toThrow(/500/);
  });

  it("when no fetchFn is supplied, the default is bound to globalThis (browser regression)", async () => {
    // Reproduces the "Illegal invocation" bug: in browsers, fetch must be
    // called with `this === globalThis`. We replace globalThis.fetch with
    // a strict-this fetch and confirm HttpSink can still call it.
    const original = globalThis.fetch;
    let captured: { thisArg: unknown; url: string } | null = null;
    const strictFetch = function (this: unknown, url: RequestInfo | URL, _init?: RequestInit) {
      // Mimic browser semantics: throw if this isn't globalThis.
      if (this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      captured = { thisArg: this, url: String(url) };
      return Promise.resolve(new Response("{}", { status: 200 }));
    };
    Object.defineProperty(globalThis, "fetch", {
      value: strictFetch,
      configurable: true,
      writable: true,
    });
    try {
      const sink = new HttpSink("https://example.com/ingest");
      await sink.emit(evt);
      expect(captured).not.toBeNull();
      expect(captured!.thisArg).toBe(globalThis);
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });

  it("does not set keepalive/cors when running in Node (no window global)", async () => {
    const calls: RequestInit[] = [];
    const fakeFetch = (async (_url: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push(init);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const sink = new HttpSink("https://example.com/ingest", fakeFetch);
    await sink.emit(evt);

    expect(calls[0]?.keepalive).toBe(false);
    expect(calls[0]?.mode).toBeUndefined();
  });
});
