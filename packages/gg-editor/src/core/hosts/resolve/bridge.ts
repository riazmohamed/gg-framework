import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { logError, logInfo, logWarn } from "../../logger.js";
import { findPython, type PythonCmd } from "../../python.js";
import { BRIDGE_PY } from "./bridge-source.js";

// Re-export so existing import sites keep compiling.
export { findPython, type PythonCmd } from "../../python.js";

/**
 * Cross-platform Resolve Python bridge.
 *
 * Lifecycle: spawn-once, talk-many. Each call sends one JSON line on stdin
 * and waits for the matching response line on stdout. Out-of-band lines
 * (e.g. the bootstrap _ready message) are ignored after the initial handshake.
 *
 * Cross-platform notes:
 *  - macOS/Linux ship `python3`. Windows often only has `python` or the `py`
 *    launcher. We probe in that order.
 *  - The Resolve scripting library lives in different default paths per OS;
 *    handled in resolveEnv().
 *  - We force UTF-8 (PYTHONIOENCODING) so JSON with non-ASCII names is safe
 *    on Windows where the default code page can mangle stdio.
 *  - Python on Windows may emit \r\n; we split on /\r?\n/ explicitly.
 */

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export interface BridgeError extends Error {
  trace?: string;
}

export class ResolveBridge {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<string, PendingCall>();
  private buffer = "";
  private readyPromise?: Promise<void>;
  private nextId = 1;
  private bridgePath?: string;

  /**
   * The child process is dead when:
   *   - we never spawned it,
   *   - it exited naturally (exitCode !== null),
   *   - or it was signalled (signalCode !== null).
   *
   * Node's ChildProcess exposes both fields directly so we don't keep a
   * parallel `dead` flag in sync — the standard idiom across real codebases
   * (mastra, openclaw, AFFiNE, midscene, paseo, takt, rivet) reads them
   * straight off the child.
   */
  private isChildDead(): boolean {
    if (!this.child) return true;
    return this.child.exitCode !== null || this.child.signalCode !== null;
  }

  /**
   * Start the bridge. Idempotent — subsequent calls return the same readiness
   * promise. After the bridge dies (Resolve quit, Python crash), the next
   * call respawns from scratch.
   */
  ensureStarted(): Promise<void> {
    // Recovery: if the previous bridge died, drop the cached promise and
    // respawn. Concurrent callers all observe the same fresh promise because
    // we set `readyPromise` synchronously before returning.
    if (this.readyPromise && this.isChildDead()) {
      this.readyPromise = undefined;
      this.handshakeDone = false;
      this.buffer = "";
      this.child = undefined;
    }
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise<void>((resolve, reject) => {
      const py = findPython();
      if (!py) {
        reject(
          new Error(
            "No Python interpreter found. Install Python 3 (python3 / python / 'py -3') and ensure it's on PATH.",
          ),
        );
        return;
      }

      // Write the embedded source to a temp dir on first launch.
      const dir = mkdtempSync(join(tmpdir(), "gg-editor-resolve-"));
      const scriptPath = join(dir, "bridge.py");
      writeFileSync(scriptPath, BRIDGE_PY, { encoding: "utf8" });
      this.bridgePath = scriptPath;

      const env = resolveEnv(py);
      logInfo("bridge", "spawn", {
        py: py.cmd + (py.args.length ? " " + py.args.join(" ") : ""),
        api: env.RESOLVE_SCRIPT_API,
        lib: env.RESOLVE_SCRIPT_LIB,
        pyhome: env.PYTHONHOME,
      });
      const child = spawn(py.cmd, [...py.args, scriptPath], {
        env,
        stdio: ["pipe", "pipe", "pipe"],
        // Don't let Resolve's huge env or our pipe inherit a TTY on Windows.
        windowsHide: true,
      });

      this.child = child;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      // Capture stderr for diagnostics. Resolve's Python imports can emit
      // warnings on stderr we don't want to crash on.
      let stderrBuf = "";
      child.stderr.on("data", (chunk: string) => {
        stderrBuf += chunk;
        if (stderrBuf.length > 8192) stderrBuf = stderrBuf.slice(-8192);
      });

      child.on("error", (err) => {
        // child.exitCode/signalCode will be set by the runtime; no extra flag needed.
        logError("bridge", "spawn_fail", { error: err.message });
        reject(new Error(`Failed to spawn Python: ${err.message}`));
      });

      child.on("exit", (code, signal) => {
        const reason = signal ? `signal ${signal}` : `exit ${code}`;
        logWarn("bridge", "exit", {
          reason,
          handshake: this.handshakeDone ? "done" : "pending",
          stderr: stderrBuf ? stderrBuf.slice(-500) : undefined,
        });
        const err = new Error(
          `Resolve bridge died (${reason}).${stderrBuf ? "\nstderr: " + stderrBuf.slice(-500) : ""}`,
        );
        // Reject every pending call.
        for (const [, pending] of this.pending) pending.reject(err);
        this.pending.clear();
        if (!this.handshakeDone) reject(err);
      });

      child.stdout.on("data", (chunk: string) => {
        this.buffer += chunk;
        // Split on either \n or \r\n.
        let nl: number;
        while ((nl = this.buffer.search(/\r?\n/)) >= 0) {
          const line = this.buffer.slice(0, nl);
          // Skip the matched separator (1 or 2 bytes).
          const skip = this.buffer[nl] === "\r" && this.buffer[nl + 1] === "\n" ? 2 : 1;
          this.buffer = this.buffer.slice(nl + skip);
          if (line.trim()) this.handleLine(line, resolve, reject);
        }
      });

      // Safety: if Python imports take too long or the bridge silently fails
      // to print _ready, time out.
      setTimeout(() => {
        if (!this.handshakeDone) {
          logError("bridge", "handshake_timeout", {
            stderr: stderrBuf ? stderrBuf.slice(-500) : undefined,
          });
          reject(
            new Error(
              "Resolve bridge handshake timed out after 10s. Check Resolve is running, " +
                "external scripting is enabled (Preferences → System → General), and Studio is licensed.",
            ),
          );
          this.kill();
        }
      }, 10_000).unref();
    });

    return this.readyPromise;
  }

  private handshakeDone = false;

  private handleLine(line: string, onReady: () => void, onReadyFail: (e: Error) => void): void {
    let msg: { id?: string; ok?: boolean; result?: unknown; error?: string; trace?: string };
    try {
      msg = JSON.parse(line);
    } catch {
      // Ignore non-JSON noise (Python warnings, etc.)
      return;
    }

    // Bootstrap messages.
    if (msg.id === "_ready" && msg.ok) {
      this.handshakeDone = true;
      logInfo("bridge", "ready");
      onReady();
      return;
    }
    if (msg.id === "_bootstrap" && msg.ok === false) {
      this.handshakeDone = true; // failed-but-resolved: prevent timeout double-reject
      logError("bridge", "bootstrap_fail", {
        error: msg.error ?? "unknown",
        trace: msg.trace ? msg.trace.slice(-500) : undefined,
      });
      onReadyFail(new Error(msg.error ?? "Bridge bootstrap failed."));
      this.kill();
      return;
    }

    // Regular call response.
    if (typeof msg.id === "string" && this.pending.has(msg.id)) {
      const pending = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.ok) {
        pending.resolve(msg.result);
      } else {
        const err: BridgeError = new Error(msg.error ?? "Unknown bridge error.");
        if (msg.trace) err.trace = msg.trace;
        pending.reject(err);
      }
    }
  }

  /**
   * Send a method call to the bridge. Resolves with the `result` payload,
   * rejects with a BridgeError if the bridge reports `ok: false`.
   */
  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    opts: { signal?: AbortSignal } = {},
  ): Promise<T> {
    await this.ensureStarted();
    // Use the same exitCode/signalCode probe `ensureStarted` does — catches
    // both natural exits and signals. `child.killed` only goes true after
    // an explicit kill() and would miss e.g. a Python crash mid-flight.
    if (this.isChildDead()) {
      throw new Error("Resolve bridge is not running.");
    }
    if (opts.signal?.aborted) {
      throw Object.assign(new Error("call aborted before send"), { name: "AbortError" });
    }
    const id = String(this.nextId++);
    const payload = JSON.stringify({ id, method, params }) + "\n";
    const startedAt = Date.now();

    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        // We can't kill the in-flight Python call mid-flight (it would tear
        // the bridge down for every other pending caller). Best we can do is
        // stop waiting on the JS side and let the bridge's response — if it
        // ever arrives — be silently discarded by the dispatcher.
        if (this.pending.delete(id)) {
          reject(
            Object.assign(new Error("call aborted while waiting for bridge response"), {
              name: "AbortError",
            }),
          );
        }
      };
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        resolve: (v) => {
          opts.signal?.removeEventListener("abort", onAbort);
          logInfo("bridge.call", method, {
            id,
            ms: Date.now() - startedAt,
          });
          resolve(v as T);
        },
        reject: (err) => {
          opts.signal?.removeEventListener("abort", onAbort);
          logError("bridge.call", method, {
            id,
            ms: Date.now() - startedAt,
            error: err.message,
          });
          reject(err);
        },
      });
      this.child!.stdin.write(payload, (err) => {
        if (err) {
          this.pending.delete(id);
          opts.signal?.removeEventListener("abort", onAbort);
          reject(err);
        }
      });
    });
  }

  kill(): void {
    if (this.child && !this.child.killed) {
      try {
        this.child.stdin.end();
      } catch {
        /* ignore */
      }
      this.child.kill();
    }
    // Drop the reference so isChildDead() returns true on the next call.
    // Node's exit event will fire async; we don't wait for it — the next
    // ensureStarted() sees `child === undefined` and respawns from scratch.
    this.child = undefined;
  }

  get scriptPath(): string | undefined {
    return this.bridgePath;
  }
}

// ── Helpers ─────────────────────────────────────────────────

/**
 * Build the env block the Python bridge needs. Sets RESOLVE_SCRIPT_API,
 * RESOLVE_SCRIPT_LIB, and prepends the Modules dir to PYTHONPATH if not
 * already configured.
 *
 * Honours pre-set env vars (so power users with custom installs aren't
 * overridden).
 */
export function resolveEnv(py?: PythonCmd): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  const apiDefault = defaultApiPath();
  const libDefault = defaultLibPath();
  if (!env.RESOLVE_SCRIPT_API && apiDefault) env.RESOLVE_SCRIPT_API = apiDefault;
  if (!env.RESOLVE_SCRIPT_LIB && libDefault) env.RESOLVE_SCRIPT_LIB = libDefault;

  // Prepend Modules to PYTHONPATH so DaVinciResolveScript imports.
  if (env.RESOLVE_SCRIPT_API) {
    const sep = platform() === "win32" ? ";" : ":";
    const modulesDir = join(env.RESOLVE_SCRIPT_API, "Modules");
    const existing = env.PYTHONPATH ?? "";
    if (!existing.split(sep).includes(modulesDir)) {
      env.PYTHONPATH = existing ? `${modulesDir}${sep}${existing}` : modulesDir;
    }
  }

  // UTF-8 stdio on Windows. No-op elsewhere.
  env.PYTHONIOENCODING = env.PYTHONIOENCODING ?? "utf-8";
  // Don't write .pyc to the embedded script's tempdir.
  env.PYTHONDONTWRITEBYTECODE = "1";

  // PYTHONHOME on Windows: when multiple Python installs sit on PATH (system,
  // Microsoft Store, conda, virtualenvs), the embedded interpreter Resolve
  // hosts can pick up the wrong stdlib and crash on import. Pinning
  // PYTHONHOME to the *probed* interpreter's sys.prefix avoids that.
  // No-op on macOS / Linux — they don't suffer this and forcing PYTHONHOME
  // can break Homebrew/pyenv setups.
  if (platform() === "win32" && py?.prefix && !env.PYTHONHOME) {
    env.PYTHONHOME = py.prefix;
  }

  return env;
}

function defaultApiPath(): string | undefined {
  switch (platform()) {
    case "darwin":
      return "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting";
    case "linux":
      return "/opt/resolve/Developer/Scripting";
    case "win32":
      return process.env.PROGRAMDATA
        ? join(
            process.env.PROGRAMDATA,
            "Blackmagic Design",
            "DaVinci Resolve",
            "Support",
            "Developer",
            "Scripting",
          )
        : undefined;
    default:
      return undefined;
  }
}

function defaultLibPath(): string | undefined {
  switch (platform()) {
    case "darwin":
      return "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so";
    case "linux":
      return "/opt/resolve/libs/Fusion/fusionscript.so";
    case "win32":
      return "C:\\Program Files\\Blackmagic Design\\DaVinci Resolve\\fusionscript.dll";
    default:
      return undefined;
  }
}
