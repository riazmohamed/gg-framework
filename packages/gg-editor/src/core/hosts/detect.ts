import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import type { HostName } from "../../types.js";

export interface DetectedHost {
  name: HostName;
  displayName: string;
  /** Process name(s) we matched against. */
  matched: string[];
}

/**
 * Cross-platform process scan. Returns true if any process whose name (or
 * full command line) contains one of the patterns is running.
 */
function isProcessRunning(patterns: string[]): string[] {
  const os = platform();
  let stdout: string;

  if (os === "darwin" || os === "linux") {
    const r = spawnSync("ps", ["-axo", "comm,args"], { encoding: "utf8" });
    stdout = r.stdout ?? "";
  } else if (os === "win32") {
    const r = spawnSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8" });
    stdout = r.stdout ?? "";
  } else {
    return [];
  }

  const lower = stdout.toLowerCase();
  return patterns.filter((p) => lower.includes(p.toLowerCase()));
}

const HOST_PATTERNS: Record<Exclude<HostName, "none">, { display: string; patterns: string[] }> = {
  resolve: {
    display: "DaVinci Resolve",
    // Match the macOS app bundle name and the Linux/Windows binary.
    patterns: ["DaVinci Resolve", "Resolve.exe", "resolve"],
  },
  premiere: {
    display: "Adobe Premiere Pro",
    patterns: ["Adobe Premiere Pro", "Premiere Pro", "Adobe Premiere"],
  },
};

/**
 * Auto-detect what NLE is currently running. Returns the first match.
 * If nothing is running, returns "none".
 *
 * Note: Resolve's process name is "resolve" lowercase on Linux which collides
 * with all sorts of unrelated stuff; we restrict that match to look for the
 * full app bundle path on macOS first, then fall back.
 */
export function detectHost(): DetectedHost {
  // Resolve check — be strict to avoid false positives from "dns.resolve" etc.
  const resolveBundleHits = isProcessRunning(["DaVinci Resolve.app", "DaVinci Resolve"]);
  if (resolveBundleHits.length > 0) {
    return {
      name: "resolve",
      displayName: HOST_PATTERNS.resolve.display,
      matched: resolveBundleHits,
    };
  }

  // Premiere check
  const premiereHits = isProcessRunning(HOST_PATTERNS.premiere.patterns);
  if (premiereHits.length > 0) {
    return {
      name: "premiere",
      displayName: HOST_PATTERNS.premiere.display,
      matched: premiereHits,
    };
  }

  return { name: "none", displayName: "No NLE detected", matched: [] };
}
