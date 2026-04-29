import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PremiereHttpBridge } from "./http-bridge.js";

/**
 * Stand up a tiny stub HTTP server that mimics the gg-editor-premiere-panel
 * wire protocol. Verifies the bridge:
 *   - probes /health correctly
 *   - sends well-formed POST /rpc bodies
 *   - parses ok:true and ok:false responses
 *   - surfaces non-2xx as thrown errors
 */

let server: Server;
let port: number;
let lastBody: { method?: string; params?: unknown } | null = null;
let nextResponse: { ok: boolean; result?: unknown; error?: string } = { ok: true, result: null };
let healthOk = true;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.setHeader("Content-Type", "application/json");
      if (!healthOk) {
        res.writeHead(503);
        res.end(JSON.stringify({ ok: false }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, product: "stub", port }));
      return;
    }
    if (req.method === "POST" && req.url === "/rpc") {
      let body = "";
      req.on("data", (c) => (body += c.toString()));
      req.on("end", () => {
        try {
          lastBody = JSON.parse(body);
        } catch {
          lastBody = null;
        }
        res.setHeader("Content-Type", "application/json");
        res.writeHead(200);
        res.end(JSON.stringify(nextResponse));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") port = addr.port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("PremiereHttpBridge", () => {
  it("health() returns the panel payload when reachable", async () => {
    healthOk = true;
    const b = new PremiereHttpBridge({ port });
    const h = await b.health();
    expect(h?.ok).toBe(true);
    expect(h?.product).toBe("stub");
  });

  it("health() returns null on non-2xx", async () => {
    healthOk = false;
    const b = new PremiereHttpBridge({ port });
    const h = await b.health();
    expect(h).toBeNull();
    healthOk = true;
  });

  it("call() POSTs the right body and parses ok:true", async () => {
    nextResponse = { ok: true, result: { foo: 42 } };
    const b = new PremiereHttpBridge({ port });
    const r = await b.call<{ foo: number }>("get_timeline", { x: 1 });
    expect(r).toEqual({ foo: 42 });
    expect(lastBody).toEqual({ method: "get_timeline", params: { x: 1 } });
  });

  it("call() throws when ok:false", async () => {
    nextResponse = { ok: false, error: "something broke" };
    const b = new PremiereHttpBridge({ port });
    await expect(b.call("ping")).rejects.toThrow(/something broke/);
  });
});
