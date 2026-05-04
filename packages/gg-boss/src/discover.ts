import fs from "node:fs/promises";
import path from "node:path";
import { getAppPaths } from "@kenkaiiii/ggcoder";

export interface DiscoveredProject {
  name: string;
  path: string;
  lastActiveMs: number;
  lastActiveDisplay: string;
}

/**
 * Scan ~/.gg/sessions/ and return projects sorted most-recent first.
 * Each session directory's name is the encoded cwd (slashes → underscores);
 * we decode it back and verify the directory still exists on disk.
 */
export async function discoverProjects(): Promise<DiscoveredProject[]> {
  const sessionsDir = getAppPaths().sessionsDir;
  let entries: string[];
  try {
    entries = await fs.readdir(sessionsDir);
  } catch {
    return [];
  }

  const results: DiscoveredProject[] = [];
  for (const entry of entries) {
    const dir = path.join(sessionsDir, entry);
    let stat;
    try {
      stat = await fs.stat(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    const sessionFiles = files.filter((f) => f.endsWith(".jsonl"));
    if (sessionFiles.length === 0) continue;

    let maxMtime = 0;
    for (const f of sessionFiles) {
      try {
        const s = await fs.stat(path.join(dir, f));
        if (s.mtimeMs > maxMtime) maxMtime = s.mtimeMs;
      } catch {
        // skip unreadable files
      }
    }

    const decoded = "/" + entry.replace(/_/g, "/");

    // Verify the decoded path still exists — drop dead entries from the list.
    try {
      const pathStat = await fs.stat(decoded);
      if (!pathStat.isDirectory()) continue;
    } catch {
      continue;
    }

    results.push({
      name: path.basename(decoded),
      path: decoded,
      lastActiveMs: maxMtime,
      lastActiveDisplay: formatRelativeTime(maxMtime),
    });
  }

  results.sort((a, b) => b.lastActiveMs - a.lastActiveMs);
  return results;
}

function formatRelativeTime(ms: number): string {
  if (ms === 0) return "—";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  if (diff < hour) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < week) return `${Math.floor(diff / day)}d ago`;
  if (diff < month) return `${Math.floor(diff / week)}w ago`;
  return `${Math.floor(diff / month)}mo ago`;
}
