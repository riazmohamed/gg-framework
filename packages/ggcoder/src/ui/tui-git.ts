import type { SlashCommand } from "../core/slash-commands.js";
import { getGitHubRepoSlug } from "../utils/github.js";
import {
  GITHUB_ITEM_LIMIT,
  getGitOverview,
  type GitHubItem,
  type GitOverview,
} from "../utils/git-overview.js";

/** Rows of each GitHub list shown; the desktop panel shows the newest too. */
const ITEMS_SHOWN = 10;
const CHANGES_SHOWN = 30;

/** Untracked and binary files carry no line counts, so they show none. */
function lineCounts(added: number | null, removed: number | null): string {
  if (added === null || removed === null) return "";
  return `  +${added} -${removed}`;
}

function githubSection(title: string, items: GitHubItem[] | null): string[] {
  if (items === null) return [`${title}: unavailable (needs gh signed in and a GitHub origin)`];
  if (items.length === 0) return [`${title}: none open`];
  const lines = [`${title} (${items.length}${items.length >= GITHUB_ITEM_LIMIT ? "+" : ""} open)`];
  for (const item of items.slice(0, ITEMS_SHOWN)) {
    const draft = item.draft ? " [draft]" : "";
    lines.push(`  #${item.number} ${item.title}${draft} — @${item.author}`);
  }
  if (items.length > ITEMS_SHOWN) lines.push(`  … ${items.length - ITEMS_SHOWN} more`);
  return lines;
}

/** The desktop Git panel as text: changed files, then open PRs and issues. */
export function formatGitOverview(overview: GitOverview): string {
  const lines: string[] = [];
  if (overview.changes.length === 0) {
    lines.push("Changes: working tree clean");
  } else {
    lines.push(`Changes (${overview.changes.length} files)`);
    for (const file of overview.changes.slice(0, CHANGES_SHOWN)) {
      lines.push(`  ${file.status} ${file.path}${lineCounts(file.added, file.removed)}`);
    }
    if (overview.changes.length > CHANGES_SHOWN) {
      lines.push(`  … ${overview.changes.length - CHANGES_SHOWN} more`);
    }
  }
  lines.push("", ...githubSection("Pull requests", overview.pulls));
  lines.push("", ...githubSection("Issues", overview.issues));
  return lines.join("\n");
}

export interface GitCommandDeps {
  cwd: () => string;
  /** Overridden by tests; defaults to the module the desktop's Git panel uses. */
  load?: (cwd: string) => Promise<GitOverview>;
}

async function loadOverview(cwd: string): Promise<GitOverview> {
  return getGitOverview(cwd, await getGitHubRepoSlug(cwd));
}

/** `/git` — changed files with line counts, open pull requests and issues. */
export function createGitCommand(deps: GitCommandDeps): SlashCommand {
  return {
    name: "git",
    aliases: [],
    description: "Changed files, open pull requests and issues",
    usage: "/git",
    async execute() {
      try {
        return formatGitOverview(await (deps.load ?? loadOverview)(deps.cwd()));
      } catch {
        return "Could not read this project's git status.";
      }
    },
  };
}
