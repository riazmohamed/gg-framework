import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { withPixel, reportPixel } from "./workers.js";

interface FakeCtx {
  waitUntil: (promise: Promise<unknown>) => void;
  pending: Promise<unknown>[];
}

function makeCtx(): FakeCtx {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil(p) {
      pending.push(p);
    },
    pending,
  };
}

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

let captured: CapturedRequest[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  captured = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const k in h) headers[k.toLowerCase()] = h[k]!;
    }
    captured.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers,
      body: String(init?.body ?? ""),
    });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("withPixel — fetch handler wrapping", () => {
  it("passes through a successful fetch handler unchanged", async () => {
    const handler = withPixel(
      { projectKey: "pk_test" },
      {
        async fetch(_req: Request, _env: unknown, _ctx: FakeCtx): Promise<Response> {
          return new Response("ok", { status: 200 });
        },
      },
    );
    const ctx = makeCtx();
    const res = await handler.fetch!(new Request("https://x"), {}, ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(captured).toHaveLength(0);
  });

  it("captures throws + waitUntil's the ingest POST + re-throws the original error", async () => {
    const original = new TypeError("kaboom");
    const handler = withPixel(
      { projectKey: "pk_test" },
      {
        async fetch(): Promise<Response> {
          throw original;
        },
      },
    );
    const ctx = makeCtx();
    let thrown: unknown;
    try {
      await (handler.fetch as unknown as (...a: unknown[]) => Promise<Response>)(
        new Request("https://x"),
        {},
        ctx,
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(original);
    expect(ctx.pending).toHaveLength(1);
    await Promise.all(ctx.pending);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toContain("/ingest");
    expect(captured[0]?.method).toBe("POST");
    expect(captured[0]?.headers["x-pixel-key"]).toBe("pk_test");
    const body = JSON.parse(captured[0]!.body) as { type: string; message: string; level: string };
    expect(body.type).toBe("TypeError");
    expect(body.message).toBe("kaboom");
    expect(body.level).toBe("fatal");
  });

  it("wraps scheduled handlers too", async () => {
    let called = false;
    const handler = withPixel(
      { projectKey: "pk_test" },
      {
        async scheduled(_evt: unknown, _env: unknown, _ctx: FakeCtx) {
          called = true;
          throw new Error("cron failed");
        },
      },
    );
    const ctx = makeCtx();
    await expect(
      (handler.scheduled as unknown as (...a: unknown[]) => Promise<void>)({}, {}, ctx),
    ).rejects.toThrow(/cron failed/);
    expect(called).toBe(true);
    await Promise.all(ctx.pending);
    expect(captured).toHaveLength(1);
  });

  it("preserves non-handler properties on the export object", () => {
    const handler = withPixel({ projectKey: "pk_test" }, {
      async fetch() {
        return new Response("ok");
      },
      // Custom property — must survive the wrap.
      someConfig: { hello: "world" },
    } as unknown as { fetch: AnyFn; someConfig: { hello: string } }) as unknown as {
      someConfig: { hello: string };
    };
    expect(handler.someConfig.hello).toBe("world");
  });
});

describe("reportPixel — manual reports", () => {
  it("posts a manual report through ctx.waitUntil", async () => {
    const ctx = makeCtx();
    reportPixel(ctx, { projectKey: "pk_test" }, { message: "hello world" });
    await Promise.all(ctx.pending);
    expect(captured).toHaveLength(1);
    const body = JSON.parse(captured[0]!.body) as { message: string; manual_report: boolean };
    expect(body.message).toBe("hello world");
    expect(body.manual_report).toBe(true);
  });

  it("preserves the user message even when an error is provided", async () => {
    const ctx = makeCtx();
    reportPixel(
      ctx,
      { projectKey: "pk_test" },
      { message: "failed to fetch user", error: new RangeError("inner cause") },
    );
    await Promise.all(ctx.pending);
    const body = JSON.parse(captured[0]!.body) as { type: string; message: string };
    expect(body.type).toBe("RangeError");
    expect(body.message).toBe("failed to fetch user");
  });
});

// Silence vitest unused-import warning for vi
void vi;

type AnyFn = (...args: unknown[]) => unknown;
