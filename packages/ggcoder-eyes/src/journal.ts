import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";

export type JournalKind = "rough" | "wish" | "blocked";
export type JournalStatus = "open" | "deferred" | "acked";

export type JournalEntry = {
  id: string;
  ts: string;
  kind: JournalKind;
  reason: string;
  probe?: string;
  status: JournalStatus;
};

export function eyesRoot(cwd: string = process.cwd()): string {
  return resolve(cwd, ".gg/eyes");
}

export function manifestPath(cwd: string = process.cwd()): string {
  return resolve(eyesRoot(cwd), "manifest.json");
}

export function journalPath(cwd: string = process.cwd()): string {
  return resolve(eyesRoot(cwd), "journal.jsonl");
}

/** Single gate for every eyes-related runtime behavior. If this returns false,
 * the project has not been set up with `/eyes` and all integrations no-op. */
export function isEyesActive(cwd: string = process.cwd()): boolean {
  return existsSync(manifestPath(cwd));
}

export function genId(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 15);
  return `${ts}-${randomBytes(2).toString("hex")}`;
}

type AppendInput = {
  kind: JournalKind;
  reason: string;
  probe?: string;
  status?: JournalStatus;
};

export function appendEntry(input: AppendInput, cwd: string = process.cwd()): JournalEntry | null {
  if (!isEyesActive(cwd)) return null;
  const entry: JournalEntry = {
    id: genId(),
    ts: new Date().toISOString(),
    kind: input.kind,
    reason: input.reason,
    status: input.status ?? "open",
    ...(input.probe ? { probe: input.probe } : {}),
  };
  const p = journalPath(cwd);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(entry) + "\n");
  return entry;
}

type ReadOptions = {
  status?: JournalStatus;
  kind?: JournalKind;
  limit?: number;
  order?: "asc" | "desc";
};

export function readJournal(
  options: ReadOptions = {},
  cwd: string = process.cwd(),
): JournalEntry[] {
  if (!isEyesActive(cwd)) return [];
  const p = journalPath(cwd);
  if (!existsSync(p)) return [];
  const text = readFileSync(p, "utf8");
  let entries: JournalEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as JournalEntry);
    } catch {
      // skip malformed — logs are append-only, don't die on one bad line
    }
  }
  if (options.status) entries = entries.filter((e) => e.status === options.status);
  if (options.kind) entries = entries.filter((e) => e.kind === options.kind);
  if (options.order === "desc") entries.reverse();
  if (typeof options.limit === "number") entries = entries.slice(0, options.limit);
  return entries;
}

export function journalCount(
  options: { status?: JournalStatus; kind?: JournalKind } = {},
  cwd: string = process.cwd(),
): number {
  return readJournal(options, cwd).length;
}

/** Rewrite-based update. Journal is expected to stay small (tens to low
 * hundreds of entries); a full rewrite is fine. */
export function updateEntry(
  id: string,
  patch: Partial<Pick<JournalEntry, "status" | "reason">>,
  cwd: string = process.cwd(),
): boolean {
  if (!isEyesActive(cwd)) return false;
  const p = journalPath(cwd);
  if (!existsSync(p)) return false;
  const lines = readFileSync(p, "utf8").split("\n");
  let found = false;
  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    try {
      const entry = JSON.parse(trimmed) as JournalEntry;
      if (entry.id === id) {
        found = true;
        return JSON.stringify({ ...entry, ...patch });
      }
      return line;
    } catch {
      return line;
    }
  });
  if (!found) return false;
  writeFileSync(p, next.join("\n"));
  return true;
}
