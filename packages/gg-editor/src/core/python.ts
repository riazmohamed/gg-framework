import { spawn, spawnSync } from "node:child_process";
import { wireChildAbort } from "./child-abort.js";

/**
 * Shared Python helpers for one-shot sidecar invocations.
 *
 * The Resolve bridge (`hosts/resolve/bridge.ts`) is a *long-lived* Python
 * subprocess we talk to via JSON-line protocol. Other tools (beat detection,
 * face reframe, etc.) only need a one-shot invocation: spawn → write JSON to
 * stdin → read JSON from stdout → exit. Both modes share interpreter probing,
 * so `findPython()` lives here and is re-exported from bridge.ts for callers
 * that already imported it from there.
 *
 * Cross-platform notes match the bridge's:
 *   - macOS/Linux ship `python3`. Windows often only has `python` or `py -3`.
 *   - Force UTF-8 I/O so JSON with non-ASCII names is safe on Windows.
 *   - Capture stderr separately for diagnostics (warnings shouldn't break parsing).
 */

export interface PythonCmd {
  cmd: string;
  args: string[];
  /**
   * `sys.prefix` of the interpreter (Windows-only convenience for setting
   * PYTHONHOME when multiple Pythons sit on PATH). Other callers can ignore.
   */
  prefix?: string;
}

/**
 * Probe for a working Python 3 interpreter. Order matters:
 *   1. python3   — macOS/Linux standard
 *   2. python    — Windows default name; also macOS with pyenv
 *   3. py -3     — Windows launcher (when only the launcher is on PATH)
 *
 * We verify each candidate prints a 3.x version before accepting it.
 */
export function findPython(): PythonCmd | undefined {
  const candidates: PythonCmd[] = [
    { cmd: "python3", args: [] },
    { cmd: "python", args: [] },
    { cmd: "py", args: ["-3"] },
  ];

  for (const c of candidates) {
    const r = spawnSync(c.cmd, [...c.args, "--version"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (r.status === 0) {
      const out = (r.stdout || r.stderr || "").trim();
      if (/Python 3\./.test(out)) {
        // Best-effort sys.prefix probe (used on Windows for PYTHONHOME).
        const pr = spawnSync(c.cmd, [...c.args, "-c", "import sys;print(sys.prefix)"], {
          encoding: "utf8",
          windowsHide: true,
        });
        const prefix =
          pr.status === 0 && typeof pr.stdout === "string" ? pr.stdout.trim() : undefined;
        return prefix ? { ...c, prefix } : c;
      }
    }
  }
  return undefined;
}

export interface RunPythonResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunPythonOptions {
  signal?: AbortSignal;
  cwd?: string;
  /** Extra env vars layered on top of process.env. */
  env?: Record<string, string>;
  /**
   * JSON payload written to the script's stdin (one shot). Stringified by
   * the caller in most cases — pass a string directly if you need raw bytes.
   */
  stdin?: string;
}

/**
 * Run a Python script as a one-shot subprocess. Resolves with combined
 * stdout/stderr/exit-code; never rejects on a non-zero exit (callers
 * decide how to interpret it). Rejects only on spawn failure.
 *
 * Distinct from the Resolve bridge's long-lived spawn — this is for
 * sidecars that produce one JSON blob and exit.
 */
export function runPython(
  scriptPath: string,
  scriptArgs: string[],
  opts: RunPythonOptions = {},
): Promise<RunPythonResult> {
  const py = findPython();
  if (!py) {
    return Promise.reject(
      new Error(
        "No Python 3 interpreter found. Install Python 3 (python3 / python / 'py -3') and ensure it's on PATH.",
      ),
    );
  }

  const env: NodeJS.ProcessEnv = { ...process.env, ...(opts.env ?? {}) };
  // UTF-8 stdio everywhere — Windows' default codepage can mangle JSON.
  env.PYTHONIOENCODING = env.PYTHONIOENCODING ?? "utf-8";
  // Don't litter the script dir with .pyc.
  env.PYTHONDONTWRITEBYTECODE = "1";

  return new Promise((resolve, reject) => {
    const child = spawn(py.cmd, [...py.args, scriptPath, ...scriptArgs], {
      env,
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (stdout += d));
    child.stderr.on("data", (d: string) => (stderr += d));
    // Robust abort: SIGTERM → SIGKILL after 1.5s, with synchronous fire on
    // pre-aborted signals. CPU-bound Python sidecars (librosa beat detect,
    // MediaPipe face reframe) can chew through SIGTERM if they're inside a
    // numpy/cv2 inner loop — the SIGKILL escalation is non-negotiable.
    const cleanup = wireChildAbort(opts.signal, child);
    child.on("error", (e) => {
      cleanup();
      reject(e);
    });
    child.on("close", (code) => {
      cleanup();
      resolve({ code: code ?? 1, stdout, stderr });
    });

    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin);
    }
    child.stdin.end();
  });
}
