import type { Message } from "@abukhaled/gg-ai";
import path from "node:path";
import { parseSafetyBlock } from "../core/action-threats.js";
import { isScannableProjectDir, securityRowTarget } from "../core/agent-session.js";
import { recordBlockedPackages } from "../core/blocked-packages-file.js";
import {
  sameStamp,
  scanProjectLockfiles,
  stampProjectLockfiles,
  type InstalledThreat,
  type LockfileStamp,
} from "../core/installed-threats.js";
import { log } from "../core/logger.js";
import type { BlockedPackage } from "../core/shell-threats.js";
import { onThreatFeedUpdated } from "../core/threat-feed.js";

/**
 * The terminal's half of gg-safe's session-side bookkeeping. The desktop gets
 * it from `AgentSession` (installed-package watch, safety-block rows, the
 * project's "don't install" list); the TUI runs its own loop, so this wires the
 * same core modules in: a lockfile scan shortly after start, after each daily
 * feed update and after a run that changed a lockfile; one info row per
 * distinct block per run; and a hidden note so the agent replaces an infected
 * package at its next turn. Never a prompt, never on a command's critical path.
 */

/** Distinct safety rows one run may add (same cap as AgentSession). */
const MAX_SECURITY_ROWS_PER_RUN = 20;

export interface TuiSafetyWatchDeps {
  stamp: (dir: string) => Promise<LockfileStamp>;
  scan: (dir: string) => Promise<InstalledThreat[]>;
  onFeedUpdated: (listener: () => void) => () => void;
  recordBlocked: (dir: string, packages: readonly BlockedPackage[]) => Promise<string | null>;
}

const defaultDeps: TuiSafetyWatchDeps = {
  stamp: stampProjectLockfiles,
  scan: (dir) => scanProjectLockfiles(dir),
  onFeedUpdated: onThreatFeedUpdated,
  recordBlocked: (dir, packages) => recordBlockedPackages(dir, packages),
};

export interface TuiSafetyWatchOptions {
  cwd: string;
  /** Delay before the first lockfile scan. Default 5s. */
  delayMs?: number;
  /** Write to the project's "don't install" list. Default: off under vitest. */
  recordBlockedList?: boolean;
  deps?: Partial<TuiSafetyWatchDeps>;
}

/** Where the watch reports; App registers it on mount (it remounts, the watch does not). */
export interface TuiSafetyWatchSink {
  /** Show one plain line in the transcript. */
  onInfo: (text: string) => void;
  /** Notes for the agent are waiting in `takeNotes()`. */
  onNote: () => void;
}

export interface TuiSafetyWatch {
  /** Attach the transcript; lines shown while detached are replayed. Returns detach. */
  attach(sink: TuiSafetyWatchSink): () => void;
  /** Hidden notes for the agent, in order, removed from the watch. */
  takeNotes(): Message[];
  /** Every finished tool call; adds a row (and list entry) when a guard blocked it. */
  toolEnd(toolName: string, args: unknown, result: string, details: unknown): void;
  /** A run finished: reset the per-run row budget and rescan changed lockfiles. */
  runEnd(): Promise<void>;
  /** Run a lockfile scan now (one at a time, never throws). */
  scan(): Promise<void>;
  stop(): void;
}

/** The hidden note that carries a threat's instructions to the agent. */
export function installedThreatNote(threat: InstalledThreat): Message {
  return {
    role: "user",
    provenance: { source: "runtime", kind: "notification", visibility: "hidden" },
    content: threat.agentText,
  };
}

/** The transcript line for a guard's block. */
export function safetyBlockLine(rule: string, target: string): string {
  return target ? `⚠ Blocked for safety (${rule}) · ${target}` : `⚠ Blocked for safety (${rule})`;
}

export function createTuiSafetyWatch(options: TuiSafetyWatchOptions): TuiSafetyWatch {
  const deps = { ...defaultDeps, ...options.deps };
  const { cwd } = options;
  const recordList = options.recordBlockedList ?? !process.env.VITEST;
  const rowsThisRun = new Set<string>();
  let known = new Set<string>();
  let stamp: LockfileStamp | null = null;
  let scanning = false;
  let stopped = false;
  let sink: TuiSafetyWatchSink | null = null;
  // Bounded: a detached TUI (overlay remount) only ever misses a few lines.
  const pendingInfo: string[] = [];
  const pendingNotes = new Map<string, Message>();

  const info = (text: string): void => {
    if (sink) sink.onInfo(text);
    else if (pendingInfo.length < MAX_SECURITY_ROWS_PER_RUN) pendingInfo.push(text);
  };

  const row = (rule: string, target: string): void => {
    const key = `${rule}\0${target}`;
    if (rowsThisRun.has(key) || rowsThisRun.size >= MAX_SECURITY_ROWS_PER_RUN) return;
    rowsThisRun.add(key);
    info(safetyBlockLine(rule, target));
  };

  const recordBlocked = (packages: readonly BlockedPackage[]): void => {
    if (!recordList || packages.length === 0) return;
    void deps.recordBlocked(cwd, packages).then(
      (file) => {
        if (file) log("INFO", "blocked-packages", `recorded blocked packages in ${file}`);
      },
      (err: unknown) =>
        log("WARN", "blocked-packages", `could not record blocked packages: ${String(err)}`),
    );
  };

  const scan = async (): Promise<void> => {
    if (scanning || stopped) return;
    scanning = true;
    try {
      const nextStamp = await deps.stamp(cwd);
      const found = nextStamp.size === 0 ? [] : await deps.scan(cwd);
      if (stopped) return;
      stamp = nextStamp;
      const previous = known;
      known = new Set(found.map((t) => t.key));
      for (const threat of found) {
        if (previous.has(threat.key)) continue;
        log("WARN", "installed-threats", threat.message);
        info(`⚠ ${threat.message}`);
        // A later hit on the same lockfile replaces one not yet delivered.
        pendingNotes.set(threat.file, installedThreatNote(threat));
        sink?.onNote();
        row(
          "installed-malware",
          securityRowTarget(
            `${threat.packages.join(", ")} in ${path.relative(cwd, threat.file) || threat.file}`,
          ),
        );
        recordBlocked(threat.blocked);
      }
    } catch (err) {
      log("WARN", "installed-threats", `installed-package check failed: ${String(err)}`);
    } finally {
      scanning = false;
    }
  };

  // The home folder or a filesystem root is not a project: never scan it.
  const scannable = isScannableProjectDir(cwd);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let offFeed: () => void = () => {};
  if (scannable) {
    timer = setTimeout(() => void scan(), options.delayMs ?? 5_000);
    timer.unref?.();
    offFeed = deps.onFeedUpdated(() => void scan());
  }

  return {
    attach(next) {
      sink = next;
      for (const text of pendingInfo.splice(0)) next.onInfo(text);
      if (pendingNotes.size > 0) next.onNote();
      return () => {
        if (sink === next) sink = null;
      };
    },
    takeNotes() {
      const notes = [...pendingNotes.values()];
      pendingNotes.clear();
      return notes;
    },
    toolEnd(toolName, args, result, details) {
      const rule = parseSafetyBlock(result);
      if (!rule) return;
      const a = (args ?? {}) as Record<string, unknown>;
      const raw = String(a.command ?? a.input ?? a.file_path ?? a.path ?? a.url ?? toolName);
      row(rule, securityRowTarget(raw));
      const packages = (details as { safetyBlock?: { packages?: BlockedPackage[] } } | undefined)
        ?.safetyBlock?.packages;
      if (packages?.length) recordBlocked(packages);
    },
    async runEnd() {
      rowsThisRun.clear();
      if (!scannable || !stamp || stopped) return;
      const next = await deps.stamp(cwd);
      if (!sameStamp(next, stamp)) await scan();
    },
    scan,
    stop() {
      stopped = true;
      sink = null;
      if (timer) clearTimeout(timer);
      offFeed();
    },
  };
}
