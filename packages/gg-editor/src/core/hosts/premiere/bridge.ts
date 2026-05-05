import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { buildJsxScript } from "./bridge-source.js";
import { PremiereHttpBridge, type PanelKind } from "./http-bridge.js";
import { PremiereWsBridge } from "./ws-bridge.js";

/**
 * Premiere bridge. Three transports, selected lazily on first use:
 *
 *   1. **HTTP** — talks to the gg-editor-premiere-panel CEP extension running
 *      inside Premiere. The CEP panel is the HTTP server; ggeditor is the
 *      client. Required on Windows when the user is on the legacy CEP path.
 *      Per-call latency: ~10-30ms.
 *
 *   2. **WebSocket** — talks to the gg-editor-premiere-panel UXP plugin.
 *      UXP plugins **cannot listen on TCP ports**, so the roles are flipped:
 *      ggeditor hosts a localhost WS server, the plugin connects out.
 *      The plugin's hello frame is what we treat as 'health' here.
 *
 *   3. **osascript** — macOS only fallback. Spawns AppleScript that asks
 *      Premiere to evalFile a per-call JSX. Per-call latency ~200-500ms.
 *      Used when neither panel is installed/running.
 *
 * Probe order:
 *   - Try HTTP first (cheapest — pure fetch, no listening sockets).
 *   - Otherwise spin up the WS listener and wait briefly for the UXP plugin.
 *   - Otherwise on macOS, fall back to osascript.
 *   - Otherwise on Windows, surface a clear install instruction.
 */

let nextId = 1;

export type BridgeError = Error;

/**
 * Active panel runtime, surfaced for capability + diagnostic messages.
 *   - 'http-uxp'        Modern UXP panel (Premiere 25.6+).
 *   - 'http-cep'        Legacy CEP panel — supported by Adobe through Sept 2026.
 *   - 'osascript-cep'   ExtendScript via osascript (no panel installed). macOS-only.
 */
export type PremiereTransportKind = "http-uxp" | "http-cep" | "osascript-cep";

type Transport =
  | { kind: "http"; panelKind: PanelKind; bridge: PremiereHttpBridge }
  | { kind: "ws"; panelKind: "uxp"; bridge: PremiereWsBridge }
  | { kind: "osascript"; workDir: string };

/**
 * How long we wait for the UXP plugin to dial back into our WS listener
 * before giving up and trying the next transport. Kept short so users
 * without a plugin don't pay this cost on every CLI launch.
 */
const WS_HELLO_TIMEOUT_MS = 1500;

export class PremiereBridge {
  private transport?: Transport;
  private transportProbe?: Promise<Transport>;

  /**
   * Cheap pre-flight reachability check. Async because it probes the panel.
   * Safe to call from capabilities() — also surfaces the panel runtime kind so
   * the adapter can include it in HostCapabilities without needing to issue a
   * full RPC first.
   */
  static async checkReachable(): Promise<
    { ok: true; transport: PremiereTransportKind } | { ok: false; reason: string }
  > {
    // 1. Try HTTP (existing CEP panel) first — cheapest probe.
    const http = new PremiereHttpBridge();
    const health = await http.health();
    if (health?.ok) {
      const transport: PremiereTransportKind = health.kind === "uxp" ? "http-uxp" : "http-cep";
      return { ok: true, transport };
    }

    // 2. Try WS (UXP plugin). Spin up a temporary listener and see if the
    //    plugin dials in. We tear it down regardless — the real bridge in
    //    `getTransport()` will start its own listener if WS turns out to be
    //    the chosen transport.
    const probe = new PremiereWsBridge();
    try {
      await probe.start();
      const ws = await probe.health(WS_HELLO_TIMEOUT_MS);
      if (ws?.ok) return { ok: true, transport: "http-uxp" };
    } catch {
      // Couldn't bind — fall through to osascript / install message.
    } finally {
      probe.shutdown();
    }

    if (platform() === "darwin") return { ok: true, transport: "osascript-cep" };
    if (platform() === "win32") {
      return {
        ok: false,
        reason:
          "Premiere panel not reachable on http://127.0.0.1:7437. " +
          "Install the UXP panel (Premiere 25.6+, recommended): " +
          "`npx @kenkaiiii/gg-editor-premiere-panel install --uxp`. " +
          "Or the legacy CEP panel (works through Sept 2026): " +
          "`npx @kenkaiiii/gg-editor-premiere-panel install --cep`. " +
          "Then restart Premiere and open Window → Extensions → GG Editor.",
      };
    }
    return { ok: false, reason: `Premiere is not supported on platform '${platform()}'.` };
  }

  /**
   * What flavour of bridge is currently in use. Returns undefined before the
   * first call (transport hasn't been resolved yet).
   */
  getTransportKind(): PremiereTransportKind | undefined {
    if (!this.transport) return undefined;
    if (this.transport.kind === "http") {
      return this.transport.panelKind === "uxp" ? "http-uxp" : "http-cep";
    }
    if (this.transport.kind === "ws") return "http-uxp";
    return "osascript-cep";
  }

  private async getTransport(): Promise<Transport> {
    if (this.transport) return this.transport;
    if (this.transportProbe) return this.transportProbe;

    this.transportProbe = (async (): Promise<Transport> => {
      // 1. HTTP — pre-existing CEP panel.
      const http = new PremiereHttpBridge();
      const health = await http.health();
      if (health?.ok) {
        const t: Transport = {
          kind: "http",
          panelKind: health.kind ?? "cep",
          bridge: http,
        };
        this.transport = t;
        return t;
      }

      // 2. WS — UXP plugin connects to us. Hold the listener open: it stays
      //    bound for the rest of the session so the plugin can reconnect
      //    after a Premiere restart without us missing it.
      const ws = new PremiereWsBridge();
      try {
        await ws.start();
        const hello = await ws.health(WS_HELLO_TIMEOUT_MS);
        if (hello?.ok) {
          const t: Transport = { kind: "ws", panelKind: "uxp", bridge: ws };
          this.transport = t;
          return t;
        }
        ws.shutdown();
      } catch {
        ws.shutdown();
      }

      // 3. osascript — macOS only.
      if (platform() === "darwin") {
        const t: Transport = {
          kind: "osascript",
          workDir: mkdtempSync(join(tmpdir(), "gg-editor-premiere-")),
        };
        this.transport = t;
        return t;
      }
      throw new Error(
        "Premiere panel not reachable and osascript not available. " +
          "On Windows: install @kenkaiiii/gg-editor-premiere-panel " +
          "(use --uxp for Premiere 25.6+, --cep for older versions). " +
          "On macOS: ensure Premiere Pro is running.",
      );
    })();

    return this.transportProbe;
  }

  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    opts: { signal?: AbortSignal } = {},
  ): Promise<T> {
    const t = await this.getTransport();
    if (t.kind === "http") {
      return t.bridge.call<T>(method, params, opts);
    }
    if (t.kind === "ws") {
      return t.bridge.call<T>(method, params, opts);
    }
    return this.callViaOsascript<T>(method, params, t.workDir, opts.signal);
  }

  private async callViaOsascript<T>(
    method: string,
    params: Record<string, unknown>,
    workDir: string,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) {
      throw Object.assign(new Error("call aborted before send"), { name: "AbortError" });
    }
    const id = String(nextId++);
    const scriptPath = join(workDir, `cmd-${id}.jsx`);
    const outPath = join(workDir, `out-${id}.json`);

    const jsx = buildJsxScript(method, params, outPath);
    writeFileSync(scriptPath, jsx, "utf8");

    try {
      await this.runOsascript(scriptPath, signal);
      const raw = readFileSync(outPath, "utf8");
      const msg = JSON.parse(raw) as { ok: boolean; result?: T; error?: string };
      if (!msg.ok) {
        const err: BridgeError = new Error(msg.error ?? "premiere bridge error");
        throw err;
      }
      return msg.result as T;
    } finally {
      try {
        unlinkSync(scriptPath);
      } catch {
        /* */
      }
      try {
        unlinkSync(outPath);
      } catch {
        /* */
      }
    }
  }

  private runOsascript(scriptPath: string, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const jsxPath = scriptPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const apple = [
        'tell application "Adobe Premiere Pro"',
        `  do script "$.evalFile(\\"${jsxPath}\\")"`,
        "end tell",
      ].join("\n");

      const child = spawn("osascript", ["-e", apple], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d.toString()));
      const onAbort = () => {
        child.kill("SIGTERM");
        reject(Object.assign(new Error("osascript aborted"), { name: "AbortError" }));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      child.on("error", (e) => {
        signal?.removeEventListener("abort", onAbort);
        reject(e);
      });
      child.on("close", (code) => {
        signal?.removeEventListener("abort", onAbort);
        if (signal?.aborted) return; // already rejected
        if (code === 0) resolve();
        else
          reject(new Error(`osascript exited ${code}${stderr ? ": " + stderr.slice(-300) : ""}`));
      });
    });
  }

  shutdown(): void {
    if (this.transport?.kind === "http") this.transport.bridge.shutdown();
    if (this.transport?.kind === "ws") this.transport.bridge.shutdown();
    this.transport = undefined;
    this.transportProbe = undefined;
  }
}
