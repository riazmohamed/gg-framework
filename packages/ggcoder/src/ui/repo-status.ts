import type { GitHubOpenCounts } from "../utils/github.js";
import type { GitHubCI } from "../utils/github-ci.js";

/** How long a green CI result stays visible after it lands (as in the desktop app). */
export const CI_SUCCESS_VISIBLE_MS = 10_000;

export interface RepoStatusInput {
  dirtyFiles: number | null;
  counts: GitHubOpenCounts | null;
  ci: GitHubCI | null;
  /** When the current CI result was first seen as finished, for hiding green. */
  ciFinishedAt: number | null;
  now: number;
}

export type RepoStatusTone = "running" | "failed" | "passed" | "muted";

export interface RepoStatus {
  label: string;
  tone: RepoStatusTone;
}

/**
 * The footer's repo segment: uncommitted files, open PRs/issues, and CI for
 * the current commit. CI shows only while it runs, when it failed, or for a
 * few seconds after it passes, so old history never decorates the footer. It
 * is a glance, never verification evidence.
 */
export function formatRepoStatus(input: RepoStatusInput): RepoStatus | null {
  const parts: string[] = [];
  let tone: RepoStatusTone = "muted";
  const { ci } = input;
  if (ci) {
    if (ci.active) {
      parts.push(`CI ${ci.completed}/${ci.total}${ci.stale ? "?" : ""}`);
      tone = "running";
    } else if (ci.conclusion === "failure") {
      parts.push(`CI ✗ ${ci.failed} failed`);
      tone = "failed";
    } else if (
      ci.conclusion === "success" &&
      input.ciFinishedAt !== null &&
      input.now - input.ciFinishedAt < CI_SUCCESS_VISIBLE_MS
    ) {
      parts.push("CI ✓");
      tone = "passed";
    }
  }
  if (input.dirtyFiles && input.dirtyFiles > 0) {
    parts.push(`${input.dirtyFiles} changed`);
  }
  if (input.counts) {
    const { prs, issues } = input.counts;
    if (prs > 0) parts.push(`${prs} PR${prs === 1 ? "" : "s"}`);
    if (issues > 0) parts.push(`${issues} issue${issues === 1 ? "" : "s"}`);
  }
  return parts.length > 0 ? { label: parts.join(" · "), tone } : null;
}
