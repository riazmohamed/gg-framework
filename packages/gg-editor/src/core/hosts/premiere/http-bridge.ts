/**
 * HTTP transport for the Premiere bridge.
 *
 * Used on Windows (where there's no osascript) and optionally on macOS when
 * the user has installed the gg-editor-premiere-panel extension.
 *
 * Two panel runtimes are supported, both speaking the same wire protocol:
 *
 *   - **CEP** (legacy)   ExtendScript backend. Works on Premiere 22+. Adobe
 *                        has confirmed CEP support ends September 2026.
 *   - **UXP** (modern)   `require("premierepro")` backend. Required for
 *                        Premiere Pro 25.6+; the only path that survives
 *                        beyond Sept 2026.
 *
 * Both panel variants expose:
 *   - GET  /health  → {ok, product, port, kind: "cep"|"uxp", version?}
 *   - POST /rpc     → body {method, params}, response {ok, result|error}
 *
 * The bridge stays runtime-agnostic; we just record `kind` from health for
 * surfacing in capability strings + error messages.
 */

const DEFAULT_PORT = 7437;
const DEFAULT_HOST = "127.0.0.1";
const HEALTH_TIMEOUT_MS = 1500;

export type PanelKind = "cep" | "uxp";

export interface PanelHealth {
  ok: boolean;
  product: string;
  port: number;
  /** Panel runtime. Older panels may omit this; we default to "cep". */
  kind?: PanelKind;
  /** Optional version string the panel may advertise. */
  version?: string;
}

export interface HttpBridgeOptions {
  port?: number;
  host?: string;
}

export class PremiereHttpBridge {
  private readonly port: number;
  private readonly host: string;

  constructor(opts: HttpBridgeOptions = {}) {
    this.port =
      opts.port ??
      (process.env.GG_EDITOR_PREMIERE_PORT
        ? parseInt(process.env.GG_EDITOR_PREMIERE_PORT, 10)
        : DEFAULT_PORT);
    this.host = opts.host ?? DEFAULT_HOST;
  }

  /** Cheap reachability check. Returns the panel's health payload or null. */
  async health(): Promise<PanelHealth | null> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
    try {
      const r = await fetch(`http://${this.host}:${this.port}/health`, { signal: ctrl.signal });
      if (!r.ok) return null;
      const data = (await r.json()) as Partial<PanelHealth>;
      // Default kind to 'cep' for older panels that don't advertise it —
      // they predate the UXP migration and were therefore CEP by definition.
      return {
        ok: !!data.ok,
        product: data.product ?? "unknown",
        port: data.port ?? this.port,
        kind: data.kind ?? "cep",
        ...(data.version ? { version: data.version } : {}),
      };
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    opts: { signal?: AbortSignal } = {},
  ): Promise<T> {
    const r = await fetch(`http://${this.host}:${this.port}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params }),
      signal: opts.signal,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`panel HTTP ${r.status}: ${text.slice(0, 300)}`);
    }
    const msg = (await r.json()) as { ok: boolean; result?: T; error?: string };
    if (!msg.ok) throw new Error(msg.error ?? "panel error");
    return msg.result as T;
  }

  shutdown(): void {
    // No persistent state to clean up on this side; the panel keeps running.
  }
}
