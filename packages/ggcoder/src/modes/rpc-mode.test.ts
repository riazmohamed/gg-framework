import { describe, expect, it } from "vitest";
import { resolveResumePath } from "./rpc-mode.js";

/** Just the one method `resolveResumePath` uses. */
function store(result: string | null, calls: { cwd?: string; id?: string } = {}) {
  return {
    findById: async (cwd: string, id: string) => {
      calls.cwd = cwd;
      calls.id = id;
      return result;
    },
  } as unknown as Parameters<typeof resolveResumePath>[2];
}

describe("resolveResumePath", () => {
  it("returns undefined when nothing was asked for", async () => {
    expect(await resolveResumePath(undefined, "/w", store(null))).toBeUndefined();
    expect(await resolveResumePath("", "/w", store(null))).toBeUndefined();
  });

  it("resolves a bare session id to its path", async () => {
    // The whole point: AgentSession's `sessionId` option takes a path, so an
    // unresolved id would load nothing and start an empty conversation.
    const calls: { cwd?: string; id?: string } = {};
    const path = await resolveResumePath(
      "abc123",
      "/work/app",
      store("/s/app/x_abc123.jsonl", calls),
    );

    expect(path).toBe("/s/app/x_abc123.jsonl");
    expect(calls).toEqual({ cwd: "/work/app", id: "abc123" });
  });

  it("passes a path straight through without touching the store", async () => {
    const explicit = "/sessions/app/2026-01-01_abc123.jsonl";
    // A store that would throw proves the lookup is skipped entirely.
    const exploding = {
      findById: async () => {
        throw new Error("findById must not be called for a path");
      },
    } as unknown as Parameters<typeof resolveResumePath>[2];

    expect(await resolveResumePath(explicit, "/work/app", exploding)).toBe(explicit);
  });

  it("yields undefined for an id the store cannot find", async () => {
    // A stale or deleted session should start a fresh conversation, not refuse
    // to start the process at all.
    expect(await resolveResumePath("gone", "/work/app", store(null))).toBeUndefined();
  });
});
