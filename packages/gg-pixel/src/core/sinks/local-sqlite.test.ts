import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { LocalSqliteSink } from "./local-sqlite.js";
import type { WireEvent } from "../types.js";

const event: WireEvent = {
  event_id: "evt-1",
  project_key: "pk_test",
  fingerprint: "abc123",
  type: "TypeError",
  message: "Cannot read properties of undefined",
  stack: [{ fn: "foo", file: "/repo/src/foo.ts", line: 10, col: 5, in_app: true }],
  code_context: { file: "/repo/src/foo.ts", error_line: 10, lines: ["a", "b", "c"] },
  runtime: "node-22.0.0",
  manual_report: false,
  level: "error",
  occurred_at: "2026-04-29T14:22:01Z",
};

describe("LocalSqliteSink", () => {
  it("writes events into a fresh sqlite database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gg-pixel-"));
    const path = join(dir, "errors.db");
    try {
      const sink = new LocalSqliteSink(path);
      await sink.emit(event);
      await sink.emit({ ...event, event_id: "evt-2", fingerprint: "def456" });
      await sink.close();

      const db = new Database(path, { readonly: true });
      const rows = db.prepare("SELECT * FROM events ORDER BY id").all() as Array<{
        event_id: string;
        project_key: string;
        fingerprint: string;
        manual_report: number;
        stack: string;
      }>;
      db.close();

      expect(rows).toHaveLength(2);
      expect(rows[0].event_id).toBe("evt-1");
      expect(rows[0].project_key).toBe("pk_test");
      expect(rows[0].fingerprint).toBe("abc123");
      expect(rows[0].manual_report).toBe(0);
      expect(JSON.parse(rows[0].stack)).toEqual(event.stack);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects duplicate event_id (idempotency guard)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gg-pixel-"));
    const path = join(dir, "errors.db");
    try {
      const sink = new LocalSqliteSink(path);
      await sink.emit(event);
      await expect(sink.emit({ ...event, fingerprint: "different" })).rejects.toThrow();
      await sink.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
