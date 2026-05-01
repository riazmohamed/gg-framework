import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { buildJsxScript } from "./bridge-source.js";
import { PremiereHttpBridge } from "./http-bridge.js";

/**
 * Premiere bridge. Two transports:
 *
 *   1. **HTTP** — talks to the gg-editor-premiere-panel CEP extension running
 *      inside Premiere. Required on Windows; optional but supported on macOS.
 *      Per-call latency: ~10-30ms (in-process JSX inside the panel).
 *
 *   2. **osascript** — macOS only fallback. Spawns AppleScript that asks
 *      Premiere to evalFile a per-call JSX. Per-call latency ~200-500ms.
 *      Used when the panel isn't installed/running.
 *
 * `selectTransport()` is called lazily on first use:
 *   - Probes the panel's /health endpoint (1.5s timeout)
 *   - If reachable, locks to HTTP for the rest of the session
 *   - Else on macOS, falls back to osascript
 *   - Else on Windows, surfaces a clear error pointing at the panel package
 */

let nextId = 1;

export type BridgeError = Error;

type Transport =
  | { kind: "http"; bridge: PremiereHttpBridge }
  | { kind: "osascript"; workDir: string };

export class PremiereBridge {
  private transport?: Transport;
  private transportProbe?: Promise<Transport>;

  /**
   * Cheap pre-flight reachability check. Async because it probes the panel.
   * Safe to call from capabilities().
   */
  static async checkReachable(): Promise<{ ok: true } | { ok: false; reason: string }> {
    // Try the panel first regardless of platform.
    const http = new PremiereHttpBridge();
    const health = await http.health();
    if (health?.ok) return { ok: true };

    if (platform() === "darwin") return { ok: true }; // osascript fallback
    if (platform() === "win32") {
      return {
        ok: false,
        reason:
          "Premiere panel not reachable on http://127.0.0.1:7437. " +
          "Install: `npx @kenkaiiii/gg-editor-premiere-panel install`, " +
          "then restart Premiere and open Window → Extensions → GG Editor.",
      };
    }
    return { ok: false, reason: `Premiere is not supported on platform '${platform()}'.` };
  }

  private async getTransport(): Promise<Transport> {
    if (this.transport) return this.transport;
    if (this.transportProbe) return this.transportProbe;

    this.transportProbe = (async (): Promise<Transport> => {
      const http = new PremiereHttpBridge();
      const health = await http.health();
      if (health?.ok) {
        const t: Transport = { kind: "http", bridge: http };
        this.transport = t;
        return t;
      }
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
          "On Windows: install @kenkaiiii/gg-editor-premiere-panel. " +
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
    this.transport = undefined;
    this.transportProbe = undefined;
  }
}
