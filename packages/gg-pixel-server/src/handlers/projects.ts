import { projectId, projectKey, projectSecret } from "../ids.js";
import type { Db, ProjectRow } from "../types.js";

export async function createProject(db: Db, name: string): Promise<ProjectRow> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("name is required");
  const row: ProjectRow = {
    id: projectId(),
    name: trimmed,
    key: projectKey(),
    secret: projectSecret(),
    created_at: Date.now(),
  };
  await db.run("INSERT INTO projects (id, name, key, secret, created_at) VALUES (?, ?, ?, ?, ?)", [
    row.id,
    row.name,
    row.key,
    row.secret,
    row.created_at,
  ]);
  return row;
}

export async function findProjectByKey(db: Db, key: string): Promise<ProjectRow | null> {
  return db.one<ProjectRow>("SELECT * FROM projects WHERE key = ?", [key]);
}

export async function findProjectById(db: Db, id: string): Promise<ProjectRow | null> {
  return db.one<ProjectRow>("SELECT * FROM projects WHERE id = ?", [id]);
}

export async function findProjectBySecret(db: Db, secret: string): Promise<ProjectRow | null> {
  return db.one<ProjectRow>("SELECT * FROM projects WHERE secret = ?", [secret]);
}

export async function countProjectsCreatedSince(db: Db, sinceMs: number): Promise<number> {
  const row = await db.one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM projects WHERE created_at > ?",
    [sinceMs],
  );
  return row?.c ?? 0;
}
