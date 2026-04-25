import { existsSync, readFileSync } from "node:fs";
import { isEyesActive, manifestPath } from "./journal.js";

export type ProbeStatus = "pending" | "built" | "verified" | "failed";

export type ProbeEntry = {
  capability: string;
  name: string;
  impl: string;
  script: string;
  status: ProbeStatus;
  error?: string;
};

export type Manifest = {
  version: 1;
  phase_completed?: "research" | "design" | "build" | "verify" | "document";
  probes: ProbeEntry[];
};

const EMPTY: Manifest = { version: 1, probes: [] };

const VALID_STATUSES: ReadonlySet<string> = new Set(["pending", "built", "verified", "failed"]);
const VALID_PHASES: ReadonlySet<string> = new Set([
  "research",
  "design",
  "build",
  "verify",
  "document",
]);

function coerceString(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function coerceProbe(raw: unknown): ProbeEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  // name + capability are load-bearing — if both missing we can't meaningfully
  // render or re-install the probe. Drop silently rather than render "?".
  const name = typeof r.name === "string" && r.name.length > 0 ? r.name : null;
  const capability =
    typeof r.capability === "string" && r.capability.length > 0 ? r.capability : null;
  if (!name || !capability) return null;

  const status =
    typeof r.status === "string" && VALID_STATUSES.has(r.status)
      ? (r.status as ProbeStatus)
      : "pending";

  const probe: ProbeEntry = {
    name,
    capability,
    impl: coerceString(r.impl, "unknown"),
    script: coerceString(r.script, `.gg/eyes/${name}.sh`),
    status,
  };
  if (typeof r.error === "string" && r.error.length > 0) probe.error = r.error;
  return probe;
}

export function readManifest(cwd: string = process.cwd()): Manifest {
  if (!isEyesActive(cwd)) return EMPTY;
  const p = manifestPath(cwd);
  if (!existsSync(p)) return EMPTY;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return EMPTY;
  }
  if (!raw || typeof raw !== "object") return EMPTY;
  const r = raw as Record<string, unknown>;

  const probes = Array.isArray(r.probes)
    ? (r.probes.map(coerceProbe).filter((p) => p !== null) as ProbeEntry[])
    : [];

  const manifest: Manifest = { version: 1, probes };
  if (typeof r.phase_completed === "string" && VALID_PHASES.has(r.phase_completed)) {
    manifest.phase_completed = r.phase_completed as Manifest["phase_completed"];
  }
  return manifest;
}
