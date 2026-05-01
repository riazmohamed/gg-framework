import type { Db } from "./types.js";

export function d1Db(d1: D1Database): Db {
  return {
    async one<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      const result = await d1
        .prepare(sql)
        .bind(...params)
        .first<T>();
      return result ?? null;
    },
    async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await d1
        .prepare(sql)
        .bind(...params)
        .all<T>();
      return result.results;
    },
    async run(sql: string, params: unknown[] = []): Promise<void> {
      await d1
        .prepare(sql)
        .bind(...params)
        .run();
    },
  };
}
