import { execFile } from "node:child_process";

/**
 * Which GitHub account the current repo actually acts as.
 *
 * Two things decide this and they can disagree, which is the whole reason this
 * exists: `gh auth switch` sets one active account process-wide (it governs
 * `gh` commands and https pushes through the gh credential helper), but an SSH
 * remote is authenticated by whichever key its host alias maps to and ignores
 * the active account entirely. Showing only the former would confidently name
 * the wrong account on any repo cloned through a `github.com-work`-style alias.
 */
export interface GitHubIdentity {
  /** The gh CLI's active account, or null when not logged in. */
  activeAccount: string | null;
  /** The account this repo pushes as, when it can be resolved. */
  pushAccount: string | null;
  /** Origin's SSH host alias, when origin is an SSH remote. */
  sshHost: string | null;
  /** True when the repo pushes as someone other than the active account. */
  mismatch: boolean;
}

/** account → the SSH host aliases in ~/.ssh/config that authenticate as it. */
export type GitHubIdentityMap = Record<string, { sshHosts?: string[] }>;

function run(cmd: string, args: string[], cwd?: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: 3000 }, (error, stdout) => {
      resolve(error ? null : stdout.trim() || null);
    });
  });
}

/**
 * Parse `gh auth status`. Its output lists each host as
 *   ✓ Logged in to github.com account <name> (keyring)
 *     - Active account: true
 * so the account name is captured as it scrolls by and emitted when the
 * `Active account: true` line that belongs to it arrives.
 */
export function parseActiveAccount(status: string): string | null {
  let candidate: string | null = null;
  for (const line of status.split(/\r?\n/)) {
    const account = /account\s+(\S+)/.exec(line);
    if (account) candidate = account[1];
    if (/Active account:\s*true/.test(line) && candidate) return candidate;
  }
  return null;
}

/** Extract the host from an SSH remote URL, or null for https/other forms. */
export function sshHostFromRemote(remote: string): string | null {
  const scp = /^(?:ssh:\/\/)?git@([^:/]+)[:/]/.exec(remote);
  return scp ? scp[1] : null;
}

/**
 * Resolve the identity for `cwd`. Never throws and never blocks on the
 * network — a missing `gh`, a logged-out user, and a non-repo directory are
 * all ordinary states that resolve to nulls.
 */
export async function getGitHubIdentity(
  cwd: string,
  identityMap: GitHubIdentityMap = {},
): Promise<GitHubIdentity> {
  const [status, remote] = await Promise.all([
    run("gh", ["auth", "status"]),
    run("git", ["remote", "get-url", "origin"], cwd),
  ]);

  const activeAccount = status ? parseActiveAccount(status) : null;
  const sshHost = remote ? sshHostFromRemote(remote) : null;

  let pushAccount: string | null = null;
  if (sshHost) {
    // An aliased host resolves only through the user's map. Plain github.com
    // uses the default key, which we assume belongs to the active account —
    // the same assumption every single-account setup already relies on.
    const mapped = Object.entries(identityMap).find(([, v]) => v.sshHosts?.includes(sshHost));
    pushAccount = mapped ? mapped[0] : sshHost === "github.com" ? activeAccount : null;
  } else if (remote) {
    pushAccount = activeAccount;
  }

  return {
    activeAccount,
    pushAccount,
    sshHost,
    mismatch: !!pushAccount && !!activeAccount && pushAccount !== activeAccount,
  };
}

/** The single label the footer shows, or null when there's nothing useful. */
export function formatGitHubIdentity(identity: GitHubIdentity | null): string | null {
  if (!identity) return null;
  if (identity.pushAccount) return identity.pushAccount;
  // Unmapped SSH alias: name the alias rather than guess an account.
  if (identity.sshHost) return identity.sshHost;
  return identity.activeAccount;
}
