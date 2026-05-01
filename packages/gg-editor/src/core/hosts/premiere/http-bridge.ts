/**
 * HTTP transport for the Premiere bridge.
 *
 * Used on Windows (where there's no osascript) and optionally on macOS when
 * the user has installed the gg-editor-premiere-panel CEP extension.
 *
 * The panel runs a localhost HTTP server (default port 7437). We POST to
 * /rpc with {method, params} and parse the JSON response.
 */

const DEFAULT_PORT = 7437;
const DEFAULT_HOST = "127.0.0.1";
const HEALTH_TIMEOUT_MS = 1500;

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
  async health(): Promise<{ ok: boolean; product: string; port: number } | null> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
    try {
      const r = await fetch(`http://${this.host}:${this.port}/health`, { signal: ctrl.signal });
      if (!r.ok) return null;
      return (await r.json()) as { ok: boolean; product: string; port: number };
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
