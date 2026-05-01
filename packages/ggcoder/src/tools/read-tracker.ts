import crypto from "node:crypto";
import type { ToolOperations } from "./operations.js";

export interface ReadEntry {
  mtimeMs: number;
  hash: string;
}

export type ReadTracker = Map<string, ReadEntry>;

export function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function recordRead(
  tracker: ReadTracker | undefined,
  resolvedPath: string,
  content: string,
  mtimeMs: number,
): void {
  tracker?.set(resolvedPath, { mtimeMs, hash: hashContent(content) });
}

export async function recordWrite(
  tracker: ReadTracker | undefined,
  resolvedPath: string,
  content: string,
  ops: ToolOperations,
): Promise<void> {
  if (!tracker) return;
  const stat = await ops.stat(resolvedPath);
  tracker.set(resolvedPath, { mtimeMs: stat.mtimeMs, hash: hashContent(content) });
}

/**
 * Verify the file hasn't been modified since it was last read.
 * Throws if unread, or if mtime AND hash differ from the recorded value.
 * mtime alone is not sufficient — some filesystems have low resolution and
 * formatters can rewrite a file with the same mtime; we re-hash on mtime miss.
 */
export async function assertFresh(
  tracker: ReadTracker | undefined,
  resolvedPath: string,
  ops: ToolOperations,
): Promise<void> {
  if (!tracker) return;
  const entry = tracker.get(resolvedPath);
  if (!entry) {
    throw new Error("File must be read first before editing. Use the read tool first.");
  }
  const stat = await ops.stat(resolvedPath);
  if (stat.mtimeMs === entry.mtimeMs) return;
  const current = await ops.readFile(resolvedPath);
  if (hashContent(current) === entry.hash) {
    tracker.set(resolvedPath, { mtimeMs: stat.mtimeMs, hash: entry.hash });
    return;
  }
  throw new Error(
    "File has been modified since it was read (likely by a formatter, linter, or external tool). " +
      "Re-read the file before editing.",
  );
}
