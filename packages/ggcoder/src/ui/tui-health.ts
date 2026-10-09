import { readChecklistSnapshot, type ChecklistSnapshot } from "../core/checklist-snapshot.js";
import type { ChecklistStatus } from "../core/checklist-store.js";
import { createProjectHealthScanner, type ProjectHealthScan } from "../core/project-health-scan.js";
import { scoreProjectHealth, type ProjectHealth } from "../core/project-health-score.js";
import type { SlashCommand } from "../core/slash-commands.js";
import { getCurrentGitHubCI, type GitHubCI } from "../utils/github-ci.js";

/**
 * Show a prompt in the transcript as `display` and send `prompt` to the agent.
 * Resolves to a message to show instead when it can't run now (a turn is busy).
 */
export type SendPrompt = (display: string, prompt: string) => Promise<string | null>;

export interface HealthDeps {
  cwd: () => string;
  sendPrompt: SendPrompt;
  scan?: (cwd: string) => Promise<ProjectHealthScan | null>;
  ci?: (cwd: string) => Promise<GitHubCI | null>;
}

function bar(score: number | null): string {
  if (score === null) return "  n/a";
  return `${String(score).padStart(3)}%`;
}

/** The desktop title-bar badge and its popover, as plain text. */
export function formatProjectHealth(health: ProjectHealth): string {
  const lines = [`Project health: ${health.score}%`];
  if (health.cappedBy) lines.push(`Held down because: ${health.cappedBy}.`);
  if (health.truncated) lines.push("Only part of this large project was scanned.");
  for (const category of health.categories) {
    lines.push("", `${bar(category.score)}  ${category.label}: ${category.summary}`);
    for (const finding of category.findings) lines.push(`        - ${finding}`);
  }
  lines.push(
    "",
    health.fixPrompt
      ? "Run /health review to have the agent check these findings and offer fixes."
      : "Nothing to fix.",
  );
  return lines.join("\n");
}

export async function computeProjectHealth(deps: HealthDeps): Promise<ProjectHealth | null> {
  const cwd = deps.cwd();
  const scan = deps.scan ?? ((dir) => createProjectHealthScanner().scan(dir, new Date()));
  const ci = deps.ci ?? getCurrentGitHubCI;
  const [result, ciStatus] = await Promise.all([scan(cwd), ci(cwd)]);
  return result ? scoreProjectHealth(result, ciStatus) : null;
}

/** `/health` shows the score; `/health review` hands the findings to the agent. */
export function createHealthCommand(deps: HealthDeps): SlashCommand {
  return {
    name: "health",
    aliases: [],
    description: "Project health score, or `review` to have the agent check it",
    usage: "/health [review]",
    async execute(args) {
      const sub = args.trim();
      if (sub && sub !== "review") return "Usage: /health [review]";
      const health = await computeProjectHealth(deps);
      if (!health) return "Project health needs a Git repository with source files.";
      if (!sub) return formatProjectHealth(health);
      if (!health.fixPrompt) return `Project health is ${health.score}%, with nothing to fix.`;
      return (await deps.sendPrompt("/health review", health.fixPrompt)) ?? "";
    },
  };
}

const STATUS_MARK: Record<ChecklistStatus, string> = {
  passed: "✓",
  "needs-work": "✗",
  due: "↻",
  "not-run": "·",
  "not-applicable": "–",
};

const STATUS_WORD: Record<ChecklistStatus, string> = {
  passed: "passed",
  "needs-work": "needs work",
  due: "due again",
  "not-run": "not checked",
  "not-applicable": "not applicable",
};

/**
 * The checklist run prompt assumes the desktop's deferred tools (`tool_search`
 * first). The terminal app loads every tool up front, so that step is replaced;
 * if upstream rewords it, the replace is a no-op and the model copes.
 */
function forTerminal(prompt: string): string {
  return prompt.replace(
    'The `checklist` tool is loaded on demand. Call `tool_search` with the query "checklist" first.',
    "The `checklist` tool is already loaded.",
  );
}

export function formatChecklist(snapshot: ChecklistSnapshot): string {
  const lines = ["Project checklist"];
  let group = "";
  for (const row of snapshot.items) {
    if (row.group !== group) {
      group = row.group;
      lines.push("", group);
    }
    const when = row.checkedAt ? `, ${row.checkedAt.slice(0, 10)}` : "";
    const changed = row.changedSinceCheck && row.checkedAt ? ", code changed since" : "";
    lines.push(
      `  ${STATUS_MARK[row.status]} ${row.id.padEnd(22)} ${row.title} (${STATUS_WORD[row.status]}${when}${changed})`,
    );
    if (row.summary && row.status !== "not-run") lines.push(`      ${row.summary}`);
  }
  for (const warning of snapshot.detectionWarnings) lines.push(`! ${warning}`);
  lines.push(
    "",
    `Results are stored in .gg-checklist.json and fall due after ${snapshot.staleAfterDays} days.`,
    "Run one with /checklist run <id>, or the next unchecked one with /checklist next.",
  );
  return lines.join("\n");
}

export interface ChecklistDeps {
  cwd: () => string;
  sendPrompt: SendPrompt;
  read?: (cwd: string) => ReturnType<typeof readChecklistSnapshot>;
}

/** `/checklist` lists the items; `run <id>` / `next` has the agent check one. */
export function createChecklistCommand(deps: ChecklistDeps): SlashCommand {
  return {
    name: "checklist",
    aliases: [],
    description: "Project health checklist; `run <id>` or `next` checks an item",
    usage: "/checklist [run <id> | next]",
    async execute(args) {
      const [sub, id, ...rest] = args.trim().split(/\s+/).filter(Boolean);
      if (rest.length > 0 || (sub && sub !== "run" && sub !== "next") || (sub === "run" && !id)) {
        return "Usage: /checklist [run <id> | next]";
      }
      const read = deps.read ?? ((cwd) => readChecklistSnapshot(cwd, new Date()));
      const snapshot = await read(deps.cwd());
      if (!snapshot.ok) return `Could not read the checklist: ${snapshot.error}`;
      if (!sub) return formatChecklist(snapshot.value);
      const row =
        sub === "next"
          ? snapshot.value.items.find((item) => item.status === "not-run" || item.status === "due")
          : snapshot.value.items.find((item) => item.id === id);
      if (!row) {
        return sub === "next"
          ? "Every checklist item is up to date."
          : `Unknown checklist item: ${id}. Run /checklist to see the ids.`;
      }
      if (!row.runPrompt) return `No check is defined for ${row.id}.`;
      return (await deps.sendPrompt(`/checklist run ${row.id}`, forTerminal(row.runPrompt))) ?? "";
    },
  };
}
