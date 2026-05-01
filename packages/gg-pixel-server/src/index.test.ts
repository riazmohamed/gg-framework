import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import app from "./index.js";

// Wraps better-sqlite3 in the D1Database shape that Hono passes through
// `c.env.DB`. Only implements the methods our handlers use: prepare/bind +
// first/all/run. Anything we don't use throws — that's the contract.
function makeFakeD1(): { d1: D1Database; close(): void } {
  const raw = new Database(":memory:");
  const dir = fileURLToPath(new URL("../migrations/", import.meta.url));
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    raw.exec(readFileSync(join(dir, f), "utf8"));
  }
  function prepare(sql: string): D1PreparedStatement {
    let bound: unknown[] = [];
    const stmt: D1PreparedStatement = {
      bind(...args: unknown[]) {
        bound = args;
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        const r = raw.prepare(sql).get(...(bound as never[])) as T | undefined;
        return r ?? null;
      },
      async all<T>(): Promise<D1Result<T>> {
        const results = raw.prepare(sql).all(...(bound as never[])) as T[];
        return { results, success: true, meta: {} as never };
      },
      async run() {
        const info = raw.prepare(sql).run(...(bound as never[]));
        return {
          results: [],
          success: true,
          meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } as never,
        } as D1Result;
      },
      async raw() {
        throw new Error("raw() not implemented in fake D1");
      },
    } as unknown as D1PreparedStatement;
    return stmt;
  }
  const d1 = { prepare } as unknown as D1Database;
  return { d1, close: () => raw.close() };
}

let env: { DB: D1Database };
let close: () => void;

beforeEach(() => {
  const f = makeFakeD1();
  env = { DB: f.d1 };
  close = f.close;
});
afterEach(() => close());

async function createProject(name = "p"): Promise<{ id: string; key: string; secret: string }> {
  const res = await app.fetch(
    new Request("https://x/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }),
    env,
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; key: string; secret: string };
}

async function ingest(key: string, fingerprint = "fp"): Promise<string> {
  const res = await app.fetch(
    new Request("https://x/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event_id: crypto.randomUUID(),
        project_key: key,
        fingerprint,
        type: "TypeError",
        message: "boom",
        stack: [],
        code_context: null,
        runtime: "node-22",
        manual_report: false,
        level: "error",
        occurred_at: new Date().toISOString(),
      }),
    }),
    env,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { error_id: string };
  return body.error_id;
}

describe("auth on /api/* endpoints", () => {
  it("rejects /api/projects/:id/errors with no Authorization", async () => {
    const p = await createProject();
    const res = await app.fetch(new Request(`https://x/api/projects/${p.id}/errors`), env);
    expect(res.status).toBe(401);
  });

  it("rejects /api/projects/:id/errors with a wrong-shaped Authorization", async () => {
    const p = await createProject();
    const res = await app.fetch(
      new Request(`https://x/api/projects/${p.id}/errors`, {
        headers: { authorization: "Bearer not-a-secret" },
      }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("rejects /api/projects/:id/errors with another project's secret (forbidden)", async () => {
    const a = await createProject("a");
    const b = await createProject("b");
    const res = await app.fetch(
      new Request(`https://x/api/projects/${a.id}/errors`, {
        headers: { authorization: `Bearer ${b.secret}` },
      }),
      env,
    );
    expect(res.status).toBe(403);
  });

  it("allows reading own errors with the project secret", async () => {
    const p = await createProject();
    await ingest(p.key);
    const res = await app.fetch(
      new Request(`https://x/api/projects/${p.id}/errors`, {
        headers: { authorization: `Bearer ${p.secret}` },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { errors: Array<{ id: string }> };
    expect(body.errors).toHaveLength(1);
  });

  it("rejects DELETE /api/errors/:id from a foreign project's secret", async () => {
    const a = await createProject("a");
    const b = await createProject("b");
    const errId = await ingest(a.key);
    const forbidden = await app.fetch(
      new Request(`https://x/api/errors/${errId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${b.secret}` },
      }),
      env,
    );
    expect(forbidden.status).toBe(403);

    // Confirm the row is still there.
    const ok = await app.fetch(
      new Request(`https://x/api/errors/${errId}`, {
        headers: { authorization: `Bearer ${a.secret}` },
      }),
      env,
    );
    expect(ok.status).toBe(200);
  });

  it("rejects DELETE /api/errors/:id with no Authorization", async () => {
    const p = await createProject();
    const errId = await ingest(p.key);
    const res = await app.fetch(
      new Request(`https://x/api/errors/${errId}`, { method: "DELETE" }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("allows the project owner to DELETE its own errors", async () => {
    const p = await createProject();
    const errId = await ingest(p.key);
    const res = await app.fetch(
      new Request(`https://x/api/errors/${errId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${p.secret}` },
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it("PATCH /api/errors/:id is also scoped — foreign secret cannot change status", async () => {
    const a = await createProject("a");
    const b = await createProject("b");
    const errId = await ingest(a.key);
    const res = await app.fetch(
      new Request(`https://x/api/errors/${errId}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${b.secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "merged" }),
      }),
      env,
    );
    expect(res.status).toBe(403);
  });
});

describe("/ingest validation", () => {
  it("rejects invalid bodies with 400", async () => {
    const res = await app.fetch(
      new Request("https://x/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects payload above the body cap with 413", async () => {
    const giant = "x".repeat(80 * 1024);
    const res = await app.fetch(
      new Request("https://x/ingest", { method: "POST", body: giant }),
      env,
    );
    expect(res.status).toBe(413);
  });

  it("rejects unknown project_key with 401", async () => {
    const res = await app.fetch(
      new Request("https://x/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event_id: "evt_1",
          project_key: "pk_live_nope",
          fingerprint: "fp",
          type: "T",
          message: "m",
          stack: [],
          code_context: null,
          runtime: "node",
          manual_report: false,
          level: "error",
          occurred_at: new Date().toISOString(),
        }),
      }),
      env,
    );
    expect(res.status).toBe(401);
  });
});
