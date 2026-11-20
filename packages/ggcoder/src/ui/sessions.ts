import chalk from "chalk";
import { SessionManager, type SessionInfo } from "../core/session-manager.js";
import { gradientLine, LOGO_GAP } from "../cli/shared.js";

// OG Coder mark — fork-specific logo (block chars, "OG" not "GG").
const LOGO_LINES = [
  " \u2584\u2580\u2580\u2584 \u2584\u2580\u2580\u2580",
  " \u2588  \u2588 \u2588 \u2580\u2588",
  " \u2580\u2584\u2584\u2580 \u2580\u2584\u2584\u2580",
];

const PRIMARY = "#a78bfa";
const TEXT = "#e2e8f0";
const TEXT_DIM = "#64748b";

let _version = "";

const MAX_PROMPT_LEN = 40;

interface SessionDisplay {
  info: SessionInfo;
  firstPrompt: string;
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

/**
 * Picker label for a session. Uses the preview `SessionManager.list()` already
 * computed, which reads gzipped cold sessions and skips compaction summaries;
 * re-reading the file as plain JSONL got both wrong.
 */
export function firstPromptLabel(info: SessionInfo): string {
  const text = (info.preview ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "(no prompt)";
  return text.length > MAX_PROMPT_LEN ? text.slice(0, MAX_PROMPT_LEN) + "..." : text;
}

function renderScreen(sessions: SessionDisplay[], selectedIndex: number): string {
  const lines: string[] = [];

  const titleLines = [
    chalk.hex("#60a5fa").bold("OG Coder") +
      (_version ? chalk.hex(TEXT_DIM)(` v${_version}`) : "") +
      chalk.hex(TEXT_DIM)(" \u00b7 By ") +
      chalk.hex(TEXT).bold("Abu Khaled"),
    chalk.hex(PRIMARY)("Sessions"),
    chalk.hex(TEXT_DIM)("Select a session to resume"),
  ];
  for (let i = 0; i < LOGO_LINES.length; i++) {
    const title = titleLines[i];
    const logo = gradientLine(LOGO_LINES[i]!);
    lines.push(title === undefined ? logo : `${logo}${LOGO_GAP}${title}`);
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
      const time = formatRelativeTime(s.info.timestamp);
      const msgs = `${s.info.messageCount} msg${s.info.messageCount !== 1 ? "s" : ""}`;
      lines.push(
        chalk.hex(labelColor)(marker + s.firstPrompt) + chalk.hex(TEXT_DIM)(` — ${msgs} · ${time}`),
      );
    }
  }

  lines.push("");
  lines.push(chalk.hex(TEXT_DIM)("↑↓ navigate · Enter select · Esc cancel"));

  return lines.join("\n");
}

export async function renderSessionSelector(
  sessionsDir: string,
  cwd: string,
  version?: string,
): Promise<string | null> {
  _version = version ?? "";
  const manager = new SessionManager(sessionsDir);
  const allSessions = await manager.list(cwd);
  const top5 = allSessions.slice(0, 5);

  if (top5.length === 0) {
    console.log(chalk.hex(TEXT_DIM)("No sessions found for this directory."));
    return null;
  }

  const sessions: SessionDisplay[] = top5.map((info) => ({
    info,
    firstPrompt: firstPromptLabel(info),
  }));

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
        resolve(sessions[selectedIndex]!.info.path);
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
