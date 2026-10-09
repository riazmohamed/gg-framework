import { useEffect, useState } from "react";
import { getGitDirtyFileCount } from "../../utils/git.js";
import {
  getGitHubOpenCounts,
  getGitHubRepoSlug,
  type GitHubOpenCounts,
} from "../../utils/github.js";
import { startGitHubCIPoll, type GitHubCI } from "../../utils/github-ci.js";
import { startIntervalPoll } from "../../utils/shared-poll.js";
import { CI_SUCCESS_VISIBLE_MS, formatRepoStatus, type RepoStatus } from "../repo-status.js";

/**
 * Footer repo status: the same pollers the desktop sidecar runs (dirty files
 * every 5s, open PR/issue counts every minute, CI for HEAD), for one cwd.
 * Every poller swallows its own errors, so no `gh` or no Git just means a
 * shorter segment.
 */
export function useRepoStatus(cwd: string): RepoStatus | null {
  const [dirtyFiles, setDirtyFiles] = useState<number | null>(null);
  const [counts, setCounts] = useState<GitHubOpenCounts | null>(null);
  const [ci, setCi] = useState<GitHubCI | null>(null);
  const [ciFinishedAt, setCiFinishedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const dirty = startIntervalPoll({
      fetch: () => getGitDirtyFileCount(cwd),
      publish: setDirtyFiles,
      firstDelayMs: 1000,
      intervalMs: 5000,
    });
    let stopCounts: (() => void) | undefined;
    let cancelled = false;
    void getGitHubRepoSlug(cwd)
      .then((slug) => {
        if (!slug || cancelled) return;
        const poll = startIntervalPoll({
          fetch: () => getGitHubOpenCounts(slug),
          publish: setCounts,
          firstDelayMs: 2000,
          intervalMs: 60_000,
        });
        stopCounts = poll.stop;
      })
      .catch(() => {});
    const ciPoll = startGitHubCIPoll(cwd, (next) => {
      setCi(next);
      const finished = next && !next.active ? Date.now() : null;
      setCiFinishedAt(finished);
      setNow(Date.now());
    });
    return () => {
      cancelled = true;
      dirty.stop();
      stopCounts?.();
      ciPoll.stop();
    };
  }, [cwd]);

  // Re-render once when a green result should disappear.
  useEffect(() => {
    if (ciFinishedAt === null || ci?.conclusion !== "success") return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, ciFinishedAt + CI_SUCCESS_VISIBLE_MS - Date.now()),
    );
    timer.unref?.();
    return () => clearTimeout(timer);
  }, [ci, ciFinishedAt]);

  return formatRepoStatus({ dirtyFiles, counts, ci, ciFinishedAt, now });
}
