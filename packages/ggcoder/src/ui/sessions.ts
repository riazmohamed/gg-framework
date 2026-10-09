import chalk from "chalk";
import { readFile } from "node:fs/promises";
import { SessionManager, type SessionInfo } from "../core/session-manager.js";
import { listForeignSessions, type ProjectSource } from "../core/project-discovery.js";
import { renderLogoBlock } from "../cli/shared.js";

const PRIMARY = "#a78bfa";
const TEXT = "#e2e8f0";
const TEXT_DIM = "#64748b";

let _version = "";

const MAX_PROMPT_LEN = 40;

interface SessionDisplay {
  path: string;
  firstPrompt: string;
  /** "12 msgs · 3h ago" */
  meta: string;
  /** Set for another tool's transcript, imported when picked. */
  source?: ProjectSource;
}

/** What the picker returns: a session to resume, or a foreign one to import first. */
export interface PickedSession {
  path: string;
  source?: ProjectSource;
}

const SOURCE_LABEL: Partial<Record<ProjectSource, string>> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

function msgs(count: number): string {
  return `${count} msg${count !== 1 ? "s" : ""}`;
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_PROMPT_LEN ? flat.slice(0, MAX_PROMPT_LEN) + "..." : flat || "(empty)";
}

function formatRelativeTime(isoTimestamp: string): string {
  const diff = Date.now() - new Date(isoTimestamp).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(isoTimestamp).toLocaleDateString();
}

/** Extract first user prompt from a session JSONL file */
async function extractFirstPrompt(sessionPath: string): Promise<string> {
  try {
    const content = await readFile(sessionPath, "utf-8");
    const lines = content.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as {
          type: string;
          message?: { role: string; content: string | { type: string; text?: string }[] };
        };
        if (entry.type === "message" && entry.message?.role === "user") {
          const c = entry.message.content;
          let text: string;
          if (typeof c === "string") {
            text = c;
          } else if (Array.isArray(c)) {
            text = c.flatMap((b) => (b.type === "text" && b.text ? [b.text] : [])).join(" ") || "";
          } else {
            continue;
          }
          // Collapse whitespace and truncate
          text = text.replace(/\s+/g, " ").trim();
          if (text.length > MAX_PROMPT_LEN) {
            text = text.slice(0, MAX_PROMPT_LEN) + "...";
          }
          return text || "(empty)";
        }
      } catch {
        // Skip unparseable lines
      }
    }
  } catch {
    // File read error
  }
  return "(no prompt)";
}

function renderScreen(sessions: SessionDisplay[], selectedIndex: number): string {
  const lines: string[] = [];

  for (const row of renderLogoBlock([
    chalk.hex("#60a5fa").bold("OG Coder") +
      (_version ? chalk.hex(TEXT_DIM)(` v${_version}`) : "") +
      chalk.hex(TEXT_DIM)(" · By ") +
      chalk.hex(TEXT).bold("Abu Khaled"),
    chalk.hex(PRIMARY)("Sessions"),
    chalk.hex(TEXT_DIM)("Select a session to resume"),
  ])) {
    lines.push(row);
  }
  lines.push("");

  if (sessions.length === 0) {
    lines.push(chalk.hex(TEXT_DIM)("  No sessions found for this directory."));
  } else {
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i]!;
      const selected = i === selectedIndex;
      const marker = selected ? "❯ " : "  ";
      const labelColor = selected ? PRIMARY : TEXT;
      const tag = s.source ? chalk.hex("#d97757")(`[${SOURCE_LABEL[s.source] ?? s.source}] `) : "";
      lines.push(
        chalk.hex(labelColor)(marker) +
          tag +
          chalk.hex(labelColor)(s.firstPrompt) +
          chalk.hex(TEXT_DIM)(` — ${s.meta}`),
      );
    }
  }

  lines.push("");
  lines.push(chalk.hex(TEXT_DIM)("↑↓ navigate · Enter select · Esc cancel"));

  return lines.join("\n");
}

/**
 * The picker's rows: this project's newest OG Coder sessions, then its newest
 * Claude Code / Codex transcripts (the desktop picker shows both), tagged by
 * source. Picking a foreign row imports it before resuming.
 */
export async function loadSessionRows(
  sessionsDir: string,
  cwd: string,
  listForeign: typeof listForeignSessions = listForeignSessions,
): Promise<SessionDisplay[]> {
  const manager = new SessionManager(sessionsDir);
  const [own, foreign] = await Promise.all([
    manager.list(cwd).then((all: SessionInfo[]) => all.slice(0, 5)),
    listForeign(cwd, 5).catch(() => []),
  ]);
  const ownRows = await Promise.all(
    own.map(async (info) => ({
      path: info.path,
      firstPrompt: await extractFirstPrompt(info.path),
      meta: `${msgs(info.messageCount)} · ${formatRelativeTime(info.timestamp)}`,
    })),
  );
  const foreignRows = foreign.map((session) => ({
    path: session.path,
    firstPrompt: shorten(session.preview),
    meta: `${msgs(session.messageCount)} · ${session.lastActiveDisplay}`,
    ...(session.source ? { source: session.source } : {}),
  }));
  return [...ownRows, ...foreignRows];
}

export async function renderSessionSelector(
  sessionsDir: string,
  cwd: string,
  version?: string,
): Promise<PickedSession | null> {
  _version = version ?? "";
  const sessions = await loadSessionRows(sessionsDir, cwd);

  if (sessions.length === 0) {
    console.log(chalk.hex(TEXT_DIM)("No sessions found for this directory."));
    return null;
  }

  return new Promise((resolve) => {
    let selectedIndex = 0;

    const draw = () => {
      process.stdout.write("\x1b[u\x1b[J" + renderScreen(sessions, selectedIndex) + "\n");
    };

    process.stdout.write("\n\x1b[s");
    draw();

    process.stdin.setRawMode(true);
    process.stdin.resume();

    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\x1b[u\x1b[J");
    };

    const onData = (chunk: Buffer) => {
      const key = chunk.toString();

      // Ctrl+C
      if (key === "\x03") {
        cleanup();
        resolve(null);
        return;
      }

      // Arrow keys (must check before bare escape)
      if (key === "\x1b[A" || key === "\x1bOA") {
        if (selectedIndex > 0) {
          selectedIndex--;
          draw();
        }
        return;
      }

      if (key === "\x1b[B" || key === "\x1bOB") {
        if (selectedIndex < sessions.length - 1) {
          selectedIndex++;
          draw();
        }
        return;
      }

      // Escape (bare \x1b with no following bracket sequence)
      if (key === "\x1b") {
        cleanup();
        resolve(null);
        return;
      }

      // Enter → select
      if (key === "\r" || key === "\n") {
        cleanup();
        const picked = sessions[selectedIndex]!;
        resolve({ path: picked.path, ...(picked.source ? { source: picked.source } : {}) });
        return;
      }

      // q to quit as well
      if (key === "q") {
        cleanup();
        resolve(null);
        return;
      }
    };

    process.stdin.on("data", onData);
  });
}
