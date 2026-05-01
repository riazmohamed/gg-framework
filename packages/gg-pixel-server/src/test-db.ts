import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Db } from "./types.js";

export interface TestHarness {
  db: Db;
  raw: Database.Database;
  close(): void;
}

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

export function createTestDb(): TestHarness {
  const raw = new Database(":memory:");
  // Apply every migration in order so the in-memory schema matches what
  // wrangler applies in dev/prod.
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    raw.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  }
  const db: Db = {
    async one<T>(sql: string, params: unknown[] = []) {
      const stmt = raw.prepare(sql);
      const row = stmt.get(...(params as never[])) as T | undefined;
      return row ?? null;
    },
    async all<T>(sql: string, params: unknown[] = []) {
      const stmt = raw.prepare(sql);
      return stmt.all(...(params as never[])) as T[];
    },
    async run(sql: string, params: unknown[] = []) {
      const stmt = raw.prepare(sql);
      stmt.run(...(params as never[]));
    },
  };
  return {
    db,
    raw,
    close: () => raw.close(),
  };
}
