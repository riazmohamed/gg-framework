import { describe, expect, it } from "vitest";
import type { SlashCommandContext } from "../core/slash-commands.js";
import type { GitOverview } from "../utils/git-overview.js";
import { createGitCommand, formatGitOverview } from "./tui-git.js";

const ctx = {} as SlashCommandContext;

const overview: GitOverview = {
  changes: [
    { path: "src/a.ts", added: 12, removed: 3, status: "M" },
    { path: "logo.png", added: null, removed: null, status: "A" },
  ],
  pulls: [
    {
      number: 7,
      title: "Add /git",
      url: "https://github.com/o/r/pull/7",
      author: "riaz",
      updatedAt: "2026-10-18T00:00:00Z",
      draft: true,
    },
  ],
  issues: [],
};

describe("/git", () => {
  it("lists changed files with line counts, then pull requests and issues", () => {
    const text = formatGitOverview(overview);
    expect(text).toContain("Changes (2 files)");
    expect(text).toContain("M src/a.ts  +12 -3");
    expect(text).toContain("A logo.png\n");
    expect(text).toContain("#7 Add /git [draft] — @riaz");
    expect(text).toContain("Issues: none open");
  });

  it("says when GitHub could not be asked and the tree is clean", () => {
    const text = formatGitOverview({ changes: [], pulls: null, issues: null });
    expect(text).toContain("Changes: working tree clean");
    expect(text).toContain("Pull requests: unavailable");
    expect(text).toContain("Issues: unavailable");
  });

  it("reads the current cwd and reports a failure as text", async () => {
    const seen: string[] = [];
    const ok = createGitCommand({
      cwd: () => "/repo",
      load: async (cwd) => {
        seen.push(cwd);
        return overview;
      },
    });
    expect(await ok.execute("", ctx)).toContain("src/a.ts");
    expect(seen).toEqual(["/repo"]);

    const failing = createGitCommand({
      cwd: () => "/repo",
      load: async () => {
        throw new Error("boom");
      },
    });
    expect(await failing.execute("", ctx)).toBe("Could not read this project's git status.");
  });
});
