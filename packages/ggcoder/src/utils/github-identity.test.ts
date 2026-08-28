import { describe, it, expect } from "vitest";
import {
  parseActiveAccount,
  sshHostFromRemote,
  formatGitHubIdentity,
  type GitHubIdentity,
} from "./github-identity.js";

const STATUS = `github.com
  ✓ Logged in to github.com account riazmohamed (keyring)
  - Active account: true
  - Git operations protocol: https

  ✓ Logged in to github.com account riaztmc (keyring)
  - Active account: false
`;

describe("parseActiveAccount", () => {
  it("returns the account flagged active, not merely the first listed", () => {
    expect(parseActiveAccount(STATUS)).toBe("riazmohamed");
  });

  it("picks a later account when it is the active one", () => {
    const flipped = STATUS.replace("Active account: true", "Active account: false").replace(
      /Active account: false\n$/,
      "Active account: true\n",
    );
    expect(parseActiveAccount(flipped)).toBe("riaztmc");
  });

  it("returns null when logged out", () => {
    expect(parseActiveAccount("You are not logged into any GitHub hosts.")).toBeNull();
  });
});

describe("sshHostFromRemote", () => {
  it("reads the host alias from scp-style remotes", () => {
    expect(sshHostFromRemote("git@github.com-work:org/repo.git")).toBe("github.com-work");
  });

  it("reads the host from ssh:// remotes", () => {
    expect(sshHostFromRemote("ssh://git@github.com/org/repo.git")).toBe("github.com");
  });

  it("returns null for https remotes", () => {
    expect(sshHostFromRemote("https://github.com/org/repo.git")).toBeNull();
  });
});

describe("formatGitHubIdentity", () => {
  const base: GitHubIdentity = {
    activeAccount: "riazmohamed",
    pushAccount: null,
    sshHost: null,
    mismatch: false,
  };

  it("prefers the resolved push account", () => {
    expect(formatGitHubIdentity({ ...base, pushAccount: "riaztmc", mismatch: true })).toBe(
      "riaztmc",
    );
  });

  it("names the alias rather than guessing when an SSH host is unmapped", () => {
    expect(formatGitHubIdentity({ ...base, sshHost: "github.com-other" })).toBe("github.com-other");
  });

  it("falls back to the active account outside a repo", () => {
    expect(formatGitHubIdentity(base)).toBe("riazmohamed");
  });

  it("returns null when there is no identity at all", () => {
    expect(formatGitHubIdentity(null)).toBeNull();
  });
});
