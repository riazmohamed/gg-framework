import { describe, it, expect } from "vitest";
import { EventQueue } from "./queue.js";
import type { Sink, WireEvent } from "./types.js";

const evt = (id: string): WireEvent => ({
  event_id: `evt-${id}`,
  project_key: "pk_test",
  fingerprint: id,
  type: "TypeError",
  message: "oops",
  stack: [],
  code_context: null,
  runtime: "node-22.0.0",
  manual_report: false,
  level: "error",
  occurred_at: new Date().toISOString(),
});

describe("EventQueue", () => {
  it("emits queued events in order", async () => {
    const got: string[] = [];
    const sink: Sink = {
      emit: async (e) => {
        got.push(e.fingerprint);
      },
    };
    const q = new EventQueue(sink);
    q.enqueue(evt("a"));
    q.enqueue(evt("b"));
    q.enqueue(evt("c"));
    await q.flush();
    expect(got).toEqual(["a", "b", "c"]);
  });

  it("retries on transient failures", async () => {
    const got: string[] = [];
    let attempts = 0;
    const sink: Sink = {
      emit: async (e) => {
        if (e.fingerprint === "a" && attempts++ < 2) {
          throw new Error("transient");
        }
        got.push(e.fingerprint);
      },
    };
    const q = new EventQueue(sink);
    q.enqueue(evt("a"));
    q.enqueue(evt("b"));
    await q.flush();
    expect(got).toEqual(["a", "b"]);
    expect(attempts).toBeGreaterThanOrEqual(2);
  });

  it("drops an event after 5 failed attempts and continues", async () => {
    const got: string[] = [];
    const sink: Sink = {
      emit: async (e) => {
        if (e.fingerprint === "bad") throw new Error("permanent");
        got.push(e.fingerprint);
      },
    };
    const q = new EventQueue(sink);
    q.enqueue(evt("bad"));
    q.enqueue(evt("good"));
    await q.flush();
    expect(got).toEqual(["good"]);
  });

  it("enqueueSync uses emitSync when available, bypassing the async queue", () => {
    const got: string[] = [];
    const sink: Sink = {
      emit: async () => {
        throw new Error("async path should not be used");
      },
      emitSync: (e) => {
        got.push(e.fingerprint);
      },
    };
    const q = new EventQueue(sink);
    q.enqueueSync(evt("sync-a"));
    q.enqueueSync(evt("sync-b"));
    expect(got).toEqual(["sync-a", "sync-b"]);
  });

  it("enqueueSync falls back to async queue when sink has no emitSync", async () => {
    const got: string[] = [];
    const sink: Sink = {
      emit: async (e) => {
        got.push(e.fingerprint);
      },
    };
    const q = new EventQueue(sink);
    q.enqueueSync(evt("a"));
    await q.flush();
    expect(got).toEqual(["a"]);
  });

  it("enqueueSync falls back to async when emitSync throws", async () => {
    const got: string[] = [];
    const sink: Sink = {
      emit: async (e) => {
        got.push(`async:${e.fingerprint}`);
      },
      emitSync: () => {
        throw new Error("disk full");
      },
    };
    const q = new EventQueue(sink);
    q.enqueueSync(evt("a"));
    await q.flush();
    expect(got).toEqual(["async:a"]);
  });

  it("close() flushes then closes the sink", async () => {
    let closed = false;
    const got: string[] = [];
    const sink: Sink = {
      emit: async (e) => {
        got.push(e.fingerprint);
      },
      close: async () => {
        closed = true;
      },
    };
    const q = new EventQueue(sink);
    q.enqueue(evt("x"));
    await q.close();
    expect(got).toEqual(["x"]);
    expect(closed).toBe(true);
  });
});
