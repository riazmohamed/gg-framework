import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { PremiereWsBridge } from "./ws-bridge.js";

/**
 * Stand up the bridge on an ephemeral port range and connect a real `ws`
 * client. Verifies:
 *   - hello frame propagates to health()
 *   - health() returns null when no plugin connects within the timeout
 *   - call() round-trips id-keyed RPC
 *   - call() throws when the plugin returns ok:false
 *   - call() aborts cleanly on AbortSignal
 *   - shutdown() rejects pending calls and unbinds the port
 */

let bridges: PremiereWsBridge[] = [];
let clients: WebSocket[] = [];

afterEach(async () => {
  for (const c of clients) {
    try {
      c.close();
    } catch {
      /* */
    }
  }
  clients = [];
  for (const b of bridges) b.shutdown();
  bridges = [];
});

function makeBridge(): PremiereWsBridge {
  // Use a high random port range so we don't fight the real default.
  const base = 17000 + Math.floor(Math.random() * 1000);
  const b = new PremiereWsBridge({
    port: base,
    fallbackPorts: [base + 1, base + 2, base + 3, base + 4],
  });
  bridges.push(b);
  return b;
}

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    clients.push(ws);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

describe("PremiereWsBridge", () => {
  it("start() binds to the desired port (or a fallback)", async () => {
    const b = makeBridge();
    const port = await b.start();
    expect(typeof port).toBe("number");
    expect(b.getPort()).toBe(port);
  });

  it("health() returns the hello payload after the plugin connects", async () => {
    const b = makeBridge();
    const port = await b.start();
    const ws = await connect(port);
    ws.send(
      JSON.stringify({
        kind: "hello",
        product: "gg-editor-premiere-panel",
        panelKind: "uxp",
        version: "0.2.0",
      }),
    );
    const h = await b.health(2000);
    expect(h?.ok).toBe(true);
    expect(h?.kind).toBe("uxp");
    expect(h?.product).toBe("gg-editor-premiere-panel");
    expect(h?.version).toBe("0.2.0");
    expect(h?.port).toBe(port);
  });

  it("health() returns null when no plugin connects within the timeout", async () => {
    const b = makeBridge();
    await b.start();
    const h = await b.health(50);
    expect(h).toBeNull();
  });

  it("call() round-trips a method invocation", async () => {
    const b = makeBridge();
    const port = await b.start();
    const ws = await connect(port);
    ws.send(JSON.stringify({ kind: "hello", product: "stub", panelKind: "uxp" }));
    await b.health(2000);

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString("utf8")) as {
        id: string;
        method: string;
        params: { x?: number };
      };
      ws.send(
        JSON.stringify({
          id: msg.id,
          ok: true,
          result: { method: msg.method, doubled: (msg.params.x ?? 0) * 2 },
        }),
      );
    });

    const r = await b.call<{ method: string; doubled: number }>("get_timeline", { x: 21 });
    expect(r).toEqual({ method: "get_timeline", doubled: 42 });
  });

  it("call() rejects when the plugin returns ok:false", async () => {
    const b = makeBridge();
    const port = await b.start();
    const ws = await connect(port);
    ws.send(JSON.stringify({ kind: "hello", product: "stub", panelKind: "uxp" }));
    await b.health(2000);

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString("utf8")) as { id: string };
      ws.send(JSON.stringify({ id: msg.id, ok: false, error: "boom" }));
    });

    await expect(b.call("ping")).rejects.toThrow(/boom/);
  });

  it("call() throws when no plugin is connected", async () => {
    const b = makeBridge();
    await b.start();
    await expect(b.call("ping")).rejects.toThrow(/not connected/);
  });

  it("call() honours an AbortSignal that fires while waiting for a reply", async () => {
    const b = makeBridge();
    const port = await b.start();
    const ws = await connect(port);
    ws.send(JSON.stringify({ kind: "hello", product: "stub", panelKind: "uxp" }));
    await b.health(2000);

    // Plugin never replies — abort while we wait.
    const ctrl = new AbortController();
    const p = b.call("ping", {}, { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 20);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("shutdown() rejects pending calls and unbinds the port", async () => {
    const b = makeBridge();
    const port = await b.start();
    const ws = await connect(port);
    ws.send(JSON.stringify({ kind: "hello", product: "stub", panelKind: "uxp" }));
    await b.health(2000);

    const p = b.call("ping");
    b.shutdown();
    await expect(p).rejects.toThrow(/shutting down/);
    expect(b.getPort()).toBeUndefined();
  });

  it("most-recent-wins: a new connection drops the previous one", async () => {
    const b = makeBridge();
    const port = await b.start();
    const first = await connect(port);
    const closed = new Promise<void>((resolve) => first.once("close", () => resolve()));
    const second = await connect(port);
    second.send(JSON.stringify({ kind: "hello", product: "stub", panelKind: "uxp" }));
    await b.health(2000);
    await closed; // first socket got closed by the bridge
  });
});
