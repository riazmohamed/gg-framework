/**
 * Post-install verification.
 *
 * Mature SDKs (Sentry, PostHog, Datadog) all skip this — the wizard ends with
 * "looks good!" if file writes succeeded, even when the wired code never ran
 * a single byte. That's how every silent-failure bug we've debugged this
 * session got past the installer (stale project keys, orphaned init files,
 * sandboxed Electron renderers, missing dotenv, broken bundler copy steps).
 *
 * verifyInstall fires a synthetic event end-to-end after wiring completes:
 * spawn a Node child in the user's project, import the SDK, report a probe,
 * then poll the project's error list with the bearer secret. If the probe
 * doesn't round-trip, we know the install is broken NOW instead of weeks
 * later when an end-user finally hits a real error.
 */

import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const PROBE_FINGERPRINT_PREFIX = "__pixel_install_probe__";

export interface VerifyOptions {
  projectId: string;
  projectKey: string;
  /** Per-project bearer secret used to query the error list. */
  projectSecret: string;
  /** Backend root, e.g. "https://gg-pixel-server.buzzbeamaustralia.workers.dev" (no trailing /ingest). */
  ingestUrl: string;
  /** User's project root — the cwd we spawn the probe from for `node_modules` resolution. */
  projectRoot: string;
  fetchFn?: typeof fetch;
  spawnFn?: typeof nodeSpawn;
  /** Skip the spawned child probe entirely; useful for non-Node kinds (browser, RN). */
  skipChildProbe?: boolean;
  /** Max time to wait for the probe to appear in the error list. Default 5s. */
  timeoutMs?: number;
}

export type VerifyOutcome =
  | {
      kind: "ok";
      /** Which path delivered the probe successfully. */
      method: "child_process" | "direct_ingest";
      latencyMs: number;
    }
  | {
      kind: "failed";
      reason: string;
      hint?: string;
    };

/**
 * Returns true if the fingerprint string was produced by an install probe.
 * Used by the overlay/listing code to hide probes if cleanup ever fails.
 */
export function isInstallProbeFingerprint(fingerprint: string | null | undefined): boolean {
  return typeof fingerprint === "string" && fingerprint.startsWith(PROBE_FINGERPRINT_PREFIX);
}

export async function verifyInstall(opts: VerifyOptions): Promise<VerifyOutcome> {
  const fetchFn = opts.fetchFn ?? fetch;
  const spawnFn = opts.spawnFn ?? nodeSpawn;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const ingest = opts.ingestUrl.replace(/\/+$/, "");
  const fingerprint = `${PROBE_FINGERPRINT_PREFIX}${randomBytes(6).toString("hex")}`;
  const start = Date.now();

  // Try child-process probe first (more useful — exercises user's node_modules
  // resolution, network access, and Node version compat). Fall back to a
  // direct-fetch ingest from the installer process if the child fails.
  let method: "child_process" | "direct_ingest";
  let probeError: string | null = null;
  if (opts.skipChildProbe) {
    try {
      await postDirectIngest({
        ingestUrl: ingest,
        projectKey: opts.projectKey,
        fingerprint,
        fetchFn,
      });
      method = "direct_ingest";
    } catch (err) {
      return {
        kind: "failed",
        reason: "Direct ingest failed",
        hint: (err as Error).message,
      };
    }
  } else {
    try {
      await runChildProbe({
        projectRoot: opts.projectRoot,
        ingestUrl: ingest,
        projectKey: opts.projectKey,
        fingerprint,
        spawnFn,
      });
      method = "child_process";
    } catch (err) {
      probeError = (err as Error).message;
      try {
        await postDirectIngest({
          ingestUrl: ingest,
          projectKey: opts.projectKey,
          fingerprint,
          fetchFn,
        });
        method = "direct_ingest";
      } catch (err2) {
        return {
          kind: "failed",
          reason: "Could not deliver probe event",
          hint: `child-process: ${probeError}; direct ingest: ${(err2 as Error).message}`,
        };
      }
    }
  }

  // Poll the API with the bearer secret for the probe fingerprint.
  const probeRow = await pollForFingerprint({
    ingestUrl: ingest,
    projectId: opts.projectId,
    projectSecret: opts.projectSecret,
    fingerprint,
    timeoutMs,
    fetchFn,
  });

  if (!probeRow) {
    return {
      kind: "failed",
      reason: `Probe sent (${method}) but didn't appear in /api/projects/${opts.projectId}/errors within ${timeoutMs}ms`,
      hint: probeError ?? undefined,
    };
  }

  // Best-effort cleanup so the probe doesn't clutter the user's overlay.
  try {
    await fetchFn(`${ingest}/api/errors/${probeRow.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${opts.projectSecret}` },
    });
  } catch {
    // Listings already filter probe fingerprints, so a leaked row is harmless.
  }

  return {
    kind: "ok",
    method,
    latencyMs: Date.now() - start,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────

interface ChildProbeArgs {
  projectRoot: string;
  ingestUrl: string;
  projectKey: string;
  fingerprint: string;
  spawnFn: typeof nodeSpawn;
}

async function runChildProbe(args: ChildProbeArgs): Promise<void> {
  const ggDir = join(args.projectRoot, ".gg");
  if (!existsSync(ggDir)) mkdirSync(ggDir, { recursive: true });
  const probePath = join(ggDir, `pixel-probe-${randomBytes(4).toString("hex")}.mjs`);

  // Probe script: import the SDK to confirm the package resolves from the
  // user's node_modules, then POST directly to /ingest so we can pin the
  // fingerprint we'll poll for. (`reportPixel` computes its own fingerprint
  // from the stack, so we couldn't otherwise correlate the probe.)
  const script = `import "@kenkaiiii/gg-pixel";
const body = ${JSON.stringify({
    project_key: args.projectKey,
    fingerprint: args.fingerprint,
    type: "InstallProbe",
    message: "Install verification probe — auto-generated, safe to delete",
    stack: [],
    code_context: null,
    runtime: "",
    manual_report: true,
    level: "error",
  })};
body.event_id = "evt_probe_" + crypto.randomUUID();
body.runtime = "installer-node-" + process.versions.node;
body.occurred_at = new Date().toISOString();
const res = await fetch(${JSON.stringify(args.ingestUrl + "/ingest")}, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
if (!res.ok) {
  const txt = await res.text().catch(() => "");
  console.error("probe ingest failed: status=" + res.status + " body=" + txt.slice(0, 200));
  process.exit(1);
}
`;
  writeFileSync(probePath, script, "utf8");

  try {
    await new Promise<void>((resolve, reject) => {
      const opts: SpawnOptions = { cwd: args.projectRoot, stdio: "pipe" };
      const child: ChildProcess = args.spawnFn("node", [probePath], opts);
      let stderr = "";
      child.stderr?.on("data", (b: Buffer) => {
        stderr += b.toString();
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Probe child timed out after 10s"));
      }, 10_000);
      child.on("error", (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("exit", (code: number | null) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`Probe exited code=${code}; stderr: ${stderr.trim().slice(0, 400)}`));
      });
    });
  } finally {
    try {
      unlinkSync(probePath);
    } catch {
      // best-effort
    }
  }
}

interface DirectIngestArgs {
  ingestUrl: string;
  projectKey: string;
  fingerprint: string;
  fetchFn: typeof fetch;
}

async function postDirectIngest(args: DirectIngestArgs): Promise<void> {
  const res = await args.fetchFn(`${args.ingestUrl}/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_id: `evt_probe_${randomBytes(8).toString("hex")}`,
      project_key: args.projectKey,
      fingerprint: args.fingerprint,
      type: "InstallProbe",
      message: "Install verification probe",
      stack: [],
      code_context: null,
      runtime: `installer-node-${process.versions.node}`,
      manual_report: true,
      level: "error",
      occurred_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      // ignore
    }
    throw new Error(`POST /ingest → ${res.status} ${body.slice(0, 200)}`);
  }
}

interface PollArgs {
  ingestUrl: string;
  projectId: string;
  projectSecret: string;
  fingerprint: string;
  timeoutMs: number;
  fetchFn: typeof fetch;
}

async function pollForFingerprint(args: PollArgs): Promise<{ id: string } | null> {
  const deadline = Date.now() + args.timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await args.fetchFn(`${args.ingestUrl}/api/projects/${args.projectId}/errors`, {
        headers: { authorization: `Bearer ${args.projectSecret}` },
      });
      if (res.ok) {
        const body = (await res.json()) as { errors: Array<{ id: string; fingerprint: string }> };
        const match = body.errors.find((e) => e.fingerprint === args.fingerprint);
        if (match) return { id: match.id };
      }
    } catch {
      // Network blip — keep polling until deadline.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}
