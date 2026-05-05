/**
 * WebSocket transport for the Premiere bridge — used by the **UXP** plugin.
 *
 * Why this exists separately from `PremiereHttpBridge`:
 *
 *   UXP plugins **cannot listen on TCP ports**. Adobe sandboxes the Node-ish
 *   runtime they expose — `require("ws").Server` and `http.createServer` are
 *   not reachable. So unlike the CEP path (panel = HTTP server, ggeditor =
 *   HTTP client), the UXP path **flips the transport**:
 *
 *     - ggeditor (this side) hosts a localhost WebSocket server.
 *     - The UXP plugin connects out to it on launch and stays connected.
 *     - RPC requests flow ggeditor → plugin; responses come back on the same
 *       socket, correlated by an integer `id`.
 *
 * Wire shape (mirrors the HTTP /rpc shape so the adapter doesn't care):
 *
 *   plugin → server (initial frame, exactly once):
 *     { kind: "hello", product, panelKind: "uxp", version }
 *
 *   server → plugin (per RPC):
 *     { id: "1", method: "get_timeline", params: {} }
 *
 *   plugin → server (response):
 *     { id: "1", ok: true, result: ... }
 *     { id: "1", ok: false, error: "..." }
 *
 * The bridge surfaces the same `health()` / `call()` API as `PremiereHttpBridge`
 * so the dispatcher in `bridge.ts` can treat both transports uniformly.
 */

import { createServer, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { PanelHealth } from "./http-bridge.js";

const DEFAULT_PORT = 7437;
const FALLBACK_PORTS = [7438, 7439, 7440, 7441, 7442, 7443];
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_HELLO_TIMEOUT_MS = 1500;

export interface WsBridgeOptions {
  /** First port to try. Defaults to 7437 (matches the CEP panel). */
  port?: number;
  /** Bind host. Always 127.0.0.1 in production. */
  host?: string;
  /** Extra ports to try if `port` is busy. Defaults to 7438..7443. */
  fallbackPorts?: number[];
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  abortListener?: () => void;
  signal?: AbortSignal;
}

/**
 * Hosts a localhost WebSocket server. The Premiere UXP plugin connects out.
 * Exactly one active socket at a time — if a second client connects, the
 * older one is dropped (most recent connection wins, matches the "user
 * relaunched the panel" expectation).
 */
export class PremiereWsBridge {
  private readonly desiredPort: number;
  private readonly host: string;
  private readonly fallbackPorts: number[];

  private httpServer?: Server;
  private wss?: WebSocketServer;
  private boundPort?: number;

  private socket?: WebSocket;
  private hello?: PanelHealth;
  private waitingForHello: Array<(h: PanelHealth | null) => void> = [];

  private nextId = 1;
  private pending = new Map<string, PendingCall>();

  constructor(opts: WsBridgeOptions = {}) {
    this.desiredPort =
      opts.port ??
      (process.env.GG_EDITOR_PREMIERE_PORT
        ? parseInt(process.env.GG_EDITOR_PREMIERE_PORT, 10)
        : DEFAULT_PORT);
    this.host = opts.host ?? DEFAULT_HOST;
    this.fallbackPorts = opts.fallbackPorts ?? FALLBACK_PORTS;
  }

  /**
   * The port the WS server is actually bound to (after fallback resolution).
   * Undefined until `start()` resolves.
   */
  getPort(): number | undefined {
    return this.boundPort;
  }

  /**
   * Start the WS server. Tries `desiredPort` first, then each `fallbackPorts`
   * entry. Resolves once a port is bound; rejects if every candidate is busy.
   */
  async start(): Promise<number> {
    if (this.boundPort !== undefined) return this.boundPort;

    const candidates = [this.desiredPort, ...this.fallbackPorts];
    let lastErr: Error | undefined;
    for (const p of candidates) {
      try {
        await this.listenOn(p);
        this.boundPort = p;
        return p;
      } catch (e) {
        lastErr = e as Error;
      }
    }
    throw new Error(
      `Could not bind WS server on any of ${candidates.join(", ")}: ` +
        (lastErr?.message ?? "unknown"),
    );
  }

  private listenOn(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const http = createServer();
      const wss = new WebSocketServer({ server: http });

      wss.on("connection", (ws) => this.onConnection(ws));

      const onError = (err: Error) => {
        http.removeListener("error", onError);
        try {
          wss.close();
        } catch {
          /* */
        }
        try {
          http.close();
        } catch {
          /* */
        }
        reject(err);
      };
      http.once("error", onError);
      http.listen(port, this.host, () => {
        http.removeListener("error", onError);
        this.httpServer = http;
        this.wss = wss;
        resolve();
      });
    });
  }

  private onConnection(ws: WebSocket): void {
    // Most-recent-wins: drop any prior socket so we never have two plugins
    // racing to handle the same RPC id.
    if (this.socket && this.socket !== ws) {
      try {
        this.socket.close(1000, "replaced by new client");
      } catch {
        /* */
      }
    }
    this.socket = ws;
    this.hello = undefined;

    ws.on("message", (data) => this.onMessage(ws, data.toString("utf8")));
    ws.on("close", () => {
      if (this.socket === ws) {
        this.socket = undefined;
        this.hello = undefined;
        // Don't reject pending calls here — the plugin may reconnect quickly.
        // The call's AbortSignal / timeout is the user's escape hatch.
      }
    });
    ws.on("error", () => {
      // Per `ws` docs, 'close' will follow.
    });
  }

  private onMessage(ws: WebSocket, raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    if (msg.kind === "hello") {
      const hello: PanelHealth = {
        ok: true,
        product: typeof msg.product === "string" ? msg.product : "gg-editor-premiere-panel",
        port: this.boundPort ?? this.desiredPort,
        kind: msg.panelKind === "cep" ? "cep" : "uxp",
        ...(typeof msg.version === "string" ? { version: msg.version } : {}),
      };
      this.hello = hello;
      const waiters = this.waitingForHello.splice(0);
      for (const w of waiters) w(hello);
      return;
    }

    if (typeof msg.id !== "string") return;
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener("abort", pending.abortListener);
    }
    if (msg.ok === true) {
      pending.resolve(msg.result);
    } else {
      pending.reject(new Error(typeof msg.error === "string" ? msg.error : "panel error"));
    }
    void ws; // keep param for signature symmetry
  }

  /**
   * Wait for the hello frame from a connected plugin. Returns the hello
   * payload (mirrors `PanelHealth` so `bridge.ts` can treat WS + HTTP the
   * same), or null if no plugin connects within `timeoutMs`.
   */
  async health(timeoutMs: number = DEFAULT_HELLO_TIMEOUT_MS): Promise<PanelHealth | null> {
    if (this.hello) return this.hello;
    return new Promise<PanelHealth | null>((resolve) => {
      let settled = false;
      const t = setTimeout(() => {
        if (settled) return;
        settled = true;
        const idx = this.waitingForHello.indexOf(once);
        if (idx >= 0) this.waitingForHello.splice(idx, 1);
        resolve(null);
      }, timeoutMs);
      const once = (h: PanelHealth | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        resolve(h);
      };
      this.waitingForHello.push(once);
    });
  }

  /**
   * Round-trip an RPC. Throws if no plugin is connected, the call is
   * aborted, or the plugin returns an error response.
   */
  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    opts: { signal?: AbortSignal } = {},
  ): Promise<T> {
    if (opts.signal?.aborted) {
      throw Object.assign(new Error("call aborted before send"), { name: "AbortError" });
    }
    if (!this.socket || this.socket.readyState !== this.socket.OPEN) {
      throw new Error("Premiere UXP plugin not connected");
    }
    const id = String(this.nextId++);
    const ws = this.socket;

    return new Promise<T>((resolve, reject) => {
      const abortListener = (): void => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(Object.assign(new Error("call aborted"), { name: "AbortError" }));
      };
      const entry: PendingCall = {
        resolve: (v) => resolve(v as T),
        reject,
      };
      if (opts.signal) {
        entry.signal = opts.signal;
        entry.abortListener = abortListener;
        opts.signal.addEventListener("abort", abortListener, { once: true });
      }
      this.pending.set(id, entry);

      try {
        ws.send(JSON.stringify({ id, method, params }));
      } catch (e) {
        this.pending.delete(id);
        if (opts.signal) opts.signal.removeEventListener("abort", abortListener);
        reject(e as Error);
      }
    });
  }

  /**
   * Stop accepting connections, close the active socket, and reject all
   * pending calls. Safe to call multiple times.
   */
  shutdown(): void {
    for (const [, p] of this.pending) {
      if (p.signal && p.abortListener) p.signal.removeEventListener("abort", p.abortListener);
      p.reject(new Error("bridge shutting down"));
    }
    this.pending.clear();

    const waiters = this.waitingForHello.splice(0);
    for (const w of waiters) w(null);

    if (this.socket) {
      try {
        this.socket.close(1001, "going away");
      } catch {
        /* */
      }
      this.socket = undefined;
    }
    if (this.wss) {
      try {
        this.wss.close();
      } catch {
        /* */
      }
      this.wss = undefined;
    }
    if (this.httpServer) {
      try {
        this.httpServer.close();
      } catch {
        /* */
      }
      this.httpServer = undefined;
    }
    this.boundPort = undefined;
    this.hello = undefined;
  }
}
