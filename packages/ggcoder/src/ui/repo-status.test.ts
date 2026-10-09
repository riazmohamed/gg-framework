import { describe, expect, it } from "vitest";
import type { GitHubCI } from "../utils/github-ci.js";
import { doesFooterFitOnOneLine } from "./components/Footer.js";
import { CI_SUCCESS_VISIBLE_MS, formatRepoStatus } from "./repo-status.js";

const ci = (patch: Partial<GitHubCI>): GitHubCI => ({
  key: "k",
  url: "https://github.com/o/r/actions/runs/1",
  total: 7,
  completed: 3,
  failed: 0,
  active: true,
  conclusion: null,
  ...patch,
});
const base = { dirtyFiles: null, counts: null, ci: null, ciFinishedAt: null, now: 1_000_000 };

describe("formatRepoStatus", () => {
  it("is empty for a clean repo with no CI", () => {
    expect(formatRepoStatus(base)).toBeNull();
    expect(formatRepoStatus({ ...base, dirtyFiles: 0, counts: { prs: 0, issues: 0 } })).toBeNull();
  });

  it("shows running CI progress, changed files and open counts", () => {
    expect(
      formatRepoStatus({ ...base, ci: ci({}), dirtyFiles: 4, counts: { prs: 1, issues: 12 } }),
    ).toEqual({ label: "CI 3/7 · 4 changed · 1 PR · 12 issues", tone: "running" });
    expect(formatRepoStatus({ ...base, ci: ci({ stale: true }) })?.label).toBe("CI 3/7?");
  });

  it("keeps a failure visible and hides a pass after a few seconds", () => {
    expect(
      formatRepoStatus({ ...base, ci: ci({ active: false, conclusion: "failure", failed: 2 }) }),
    ).toEqual({ label: "CI ✗ 2 failed", tone: "failed" });
    const passed = ci({ active: false, conclusion: "success", completed: 7 });
    expect(formatRepoStatus({ ...base, ci: passed, ciFinishedAt: base.now - 1000 })).toEqual({
      label: "CI ✓",
      tone: "passed",
    });
    expect(
      formatRepoStatus({ ...base, ci: passed, ciFinishedAt: base.now - CI_SUCCESS_VISIBLE_MS }),
    ).toBeNull();
    expect(formatRepoStatus({ ...base, ci: ci({ active: false, conclusion: "cancelled" }) })).toBe(
      null,
    );
  });
});

describe("footer fit with a repo segment", () => {
  it("counts the segment when deciding whether everything fits on one line", () => {
    const args = {
      columns: 120,
      model: "claude-opus-5-5",
      tokensIn: 0,
      cwd: "/work/project",
      gitBranch: "main",
    };
    expect(doesFooterFitOnOneLine(args)).toBe(true);
    expect(doesFooterFitOnOneLine({ ...args, statusLabel: "x".repeat(80) })).toBe(false);
  });
});
