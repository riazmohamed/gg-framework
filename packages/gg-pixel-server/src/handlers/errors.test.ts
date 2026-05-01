import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestHarness } from "../test-db.js";
import { createProject } from "./projects.js";
import { ingestEvent } from "./ingest.js";
import { decayMergedErrors, getError, listErrors, patchError } from "./errors.js";
import type { ErrorRow, WireEvent } from "../types.js";

let h: TestHarness;
beforeEach(() => (h = createTestDb()));
afterEach(() => h.close());

const evt = (key: string, fp: string): WireEvent => ({
  event_id: crypto.randomUUID(),
  project_key: key,
  fingerprint: fp,
  type: "TypeError",
  message: `error ${fp}`,
  stack: [],
  code_context: null,
  runtime: "node-22",
  manual_report: false,
  level: "error",
  occurred_at: new Date().toISOString(),
});

describe("listErrors", () => {
  it("returns all errors when no status filter is provided", async () => {
    const p = await createProject(h.db, "p");
    await ingestEvent(h.db, evt(p.key, "a"));
    await ingestEvent(h.db, evt(p.key, "b"));
    const rows = await listErrors(h.db, p.id);
    expect(rows).toHaveLength(2);
  });

  it("filters by status", async () => {
    const p = await createProject(h.db, "p");
    const a = await ingestEvent(h.db, evt(p.key, "a"));
    if (a.kind !== "ok") throw new Error("setup");
    await ingestEvent(h.db, evt(p.key, "b"));
    await patchError(h.db, a.error.id, { status: "in_progress" });

    const open = await listErrors(h.db, p.id, "open");
    const inProgress = await listErrors(h.db, p.id, "in_progress");
    expect(open).toHaveLength(1);
    expect(inProgress).toHaveLength(1);
  });

  it("rejects invalid status filter", async () => {
    const p = await createProject(h.db, "p");
    await expect(listErrors(h.db, p.id, "bogus")).rejects.toThrow(/invalid status/);
  });
});

describe("patchError", () => {
  it("returns null for unknown error id", async () => {
    expect(await patchError(h.db, "err_nonexistent", { status: "merged" })).toBeNull();
  });

  it("sets fixed_at when transitioning to awaiting_review", async () => {
    const p = await createProject(h.db, "p");
    const r = await ingestEvent(h.db, evt(p.key, "a"));
    if (r.kind !== "ok") throw new Error("setup");
    const updated = await patchError(h.db, r.error.id, {
      status: "awaiting_review",
      branch: "fix/pixel-abc",
    });
    expect(updated?.status).toBe("awaiting_review");
    expect(updated?.branch).toBe("fix/pixel-abc");
    expect(updated?.fixed_at).toBeGreaterThan(0);
  });

  it("sets merged_at when transitioning to merged", async () => {
    const p = await createProject(h.db, "p");
    const r = await ingestEvent(h.db, evt(p.key, "a"));
    if (r.kind !== "ok") throw new Error("setup");
    const updated = await patchError(h.db, r.error.id, { status: "merged" });
    expect(updated?.merged_at).toBeGreaterThan(0);
  });

  it("rejects invalid status", async () => {
    const p = await createProject(h.db, "p");
    const r = await ingestEvent(h.db, evt(p.key, "a"));
    if (r.kind !== "ok") throw new Error("setup");
    await expect(patchError(h.db, r.error.id, { status: "garbage" as never })).rejects.toThrow(
      /invalid status/,
    );
  });
});

describe("getError", () => {
  it("returns the row by id", async () => {
    const p = await createProject(h.db, "p");
    const r = await ingestEvent(h.db, evt(p.key, "a"));
    if (r.kind !== "ok") throw new Error("setup");
    const fetched = await getError(h.db, r.error.id);
    expect(fetched?.id).toBe(r.error.id);
  });
});

describe("decayMergedErrors", () => {
  it("deletes only merged errors older than the cutoff", async () => {
    const p = await createProject(h.db, "p");
    const a = await ingestEvent(h.db, evt(p.key, "a"));
    const b = await ingestEvent(h.db, evt(p.key, "b"));
    if (a.kind !== "ok" || b.kind !== "ok") throw new Error("setup");

    await patchError(h.db, a.error.id, { status: "merged" });
    await patchError(h.db, b.error.id, { status: "merged" });
    // Backdate `a` to look 8 days old.
    await h.db.run("UPDATE errors SET merged_at = ? WHERE id = ?", [
      Date.now() - 8 * 24 * 60 * 60 * 1000,
      a.error.id,
    ]);

    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    await decayMergedErrors(h.db, cutoff);

    const remaining = await h.db.all<ErrorRow>("SELECT id FROM errors", []);
    expect(remaining.map((r) => r.id)).toEqual([b.error.id]);
  });
});
