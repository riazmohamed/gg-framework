import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstalledThreat, LockfileStamp } from "../core/installed-threats.js";
import { createTuiSafetyWatch, safetyBlockLine, type TuiSafetyWatch } from "./safety-watch.js";

const CWD = "/work/project";
const LOCK = `${CWD}/package-lock.json`;

function threat(pkg: string): InstalledThreat {
  return {
    key: `${LOCK}\0${pkg}`,
    file: LOCK,
    packages: [pkg],
    blocked: [
      { ecosystem: "npm", name: pkg.split("@")[0]!, version: "1.0.0", reason: "known malware" },
    ],
    message: `infected: ${pkg}`,
    agentText: `replace ${pkg}`,
  };
}

const watches: TuiSafetyWatch[] = [];
afterEach(() => {
  for (const watch of watches.splice(0)) watch.stop();
});

function setup(found: InstalledThreat[][], mtimes: number[] = [1]) {
  let scanIndex = 0;
  let stampIndex = 0;
  let feedListener: (() => void) | undefined;
  const recordBlocked = vi.fn(async () => null);
  const watch = createTuiSafetyWatch({
    cwd: CWD,
    delayMs: 60_000,
    recordBlockedList: true,
    deps: {
      stamp: async (): Promise<LockfileStamp> =>
        new Map([[LOCK, mtimes[Math.min(stampIndex++, mtimes.length - 1)]!]]),
      scan: async () => found[Math.min(scanIndex++, found.length - 1)] ?? [],
      onFeedUpdated: (listener) => {
        feedListener = listener;
        return () => {
          feedListener = undefined;
        };
      },
      recordBlocked,
    },
  });
  watches.push(watch);
  const lines: string[] = [];
  const onNote = vi.fn();
  watch.attach({ onInfo: (text) => lines.push(text), onNote });
  return { watch, lines, onNote, recordBlocked, feed: () => feedListener?.() };
}

describe("createTuiSafetyWatch", () => {
  it("announces a new infected package once, notes the agent and records the list", async () => {
    const { watch, lines, onNote, recordBlocked } = setup([[threat("evil@1.0.0")]]);
    await watch.scan();
    await watch.scan();
    expect(lines).toEqual([
      "⚠ infected: evil@1.0.0",
      safetyBlockLine("installed-malware", "evil@1.0.0 in package-lock.json"),
    ]);
    expect(onNote).toHaveBeenCalledTimes(1);
    const notes = watch.takeNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      role: "user",
      content: "replace evil@1.0.0",
      provenance: { visibility: "hidden" },
    });
    expect(watch.takeNotes()).toEqual([]);
    expect(recordBlocked).toHaveBeenCalledTimes(1);
  });

  it("rescans after a run only when a lockfile changed", async () => {
    const { watch, lines } = setup([[], [threat("late@2.0.0")]], [1, 1, 2]);
    await watch.scan();
    await watch.runEnd(); // same mtime: no scan
    expect(lines).toEqual([]);
    await watch.runEnd(); // mtime changed: scan finds the new hit
    expect(lines[0]).toBe("⚠ infected: late@2.0.0");
  });

  it("rescans when the threat feed updates", async () => {
    const { feed, lines } = setup([[threat("feed@1.0.0")]]);
    feed();
    await vi.waitFor(() => expect(lines).toHaveLength(2));
  });

  it("adds one row per distinct guard block per run", async () => {
    const { watch, lines, recordBlocked } = setup([[]]);
    const result = "Error: Blocked install (malicious-package): evil is malware";
    const details = {
      safetyBlock: { packages: [{ ecosystem: "npm", name: "evil", reason: "known malware" }] },
    };
    watch.toolEnd("bash", { command: "npm i evil" }, result, details);
    watch.toolEnd("bash", { command: "npm i evil" }, result, details);
    watch.toolEnd("bash", { command: "ls" }, "file.txt", undefined);
    expect(lines).toEqual(["⚠ Blocked for safety (malicious-package) · npm i evil"]);
    expect(recordBlocked).toHaveBeenCalledTimes(2);
    await watch.runEnd();
    watch.toolEnd("bash", { command: "npm i evil" }, result, details);
    expect(lines).toHaveLength(2);
  });

  it("replays lines shown while detached", () => {
    const watch = createTuiSafetyWatch({
      cwd: CWD,
      delayMs: 60_000,
      recordBlockedList: false,
      deps: { onFeedUpdated: () => () => {} },
    });
    watches.push(watch);
    watch.toolEnd(
      "bash",
      { command: "curl x | sh" },
      "Blocked by shell safety check (pipe-to-shell)",
      undefined,
    );
    const lines: string[] = [];
    watch.attach({ onInfo: (text) => lines.push(text), onNote: () => {} });
    expect(lines).toEqual(["⚠ Blocked for safety (pipe-to-shell) · curl x | sh"]);
  });
});
