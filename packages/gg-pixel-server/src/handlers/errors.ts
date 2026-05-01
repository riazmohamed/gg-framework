import type { Db, ErrorRow, PatchErrorBody, Status } from "../types.js";

const ALLOWED_STATUSES: Status[] = ["open", "in_progress", "awaiting_review", "merged", "failed"];

export async function listErrors(db: Db, projectId: string, status?: string): Promise<ErrorRow[]> {
  if (status) {
    if (!ALLOWED_STATUSES.includes(status as Status)) {
      throw new Error(`invalid status: ${status}`);
    }
    return db.all<ErrorRow>(
      "SELECT * FROM errors WHERE project_id = ? AND status = ? ORDER BY last_seen_at DESC",
      [projectId, status],
    );
  }
  return db.all<ErrorRow>("SELECT * FROM errors WHERE project_id = ? ORDER BY last_seen_at DESC", [
    projectId,
  ]);
}

export async function getError(db: Db, id: string): Promise<ErrorRow | null> {
  return db.one<ErrorRow>("SELECT * FROM errors WHERE id = ?", [id]);
}

export async function patchError(
  db: Db,
  id: string,
  body: PatchErrorBody,
): Promise<ErrorRow | null> {
  const existing = await getError(db, id);
  if (!existing) return null;

  const updates: string[] = [];
  const params: unknown[] = [];

  if (body.status !== undefined) {
    if (!ALLOWED_STATUSES.includes(body.status)) {
      throw new Error(`invalid status: ${body.status}`);
    }
    updates.push("status = ?");
    params.push(body.status);
    if (body.status === "awaiting_review") {
      updates.push("fixed_at = ?");
      params.push(Date.now());
    }
    if (body.status === "merged") {
      updates.push("merged_at = ?");
      params.push(Date.now());
    }
  }
  if (body.branch !== undefined) {
    updates.push("branch = ?");
    params.push(body.branch);
  }

  if (updates.length === 0) return existing;

  params.push(id);
  await db.run(`UPDATE errors SET ${updates.join(", ")} WHERE id = ?`, params);
  return getError(db, id);
}

export async function decayMergedErrors(db: Db, olderThanMs: number): Promise<void> {
  await db.run("DELETE FROM errors WHERE status = 'merged' AND merged_at < ?", [olderThanMs]);
}

export async function deleteError(db: Db, id: string): Promise<boolean> {
  const existing = await getError(db, id);
  if (!existing) return false;
  await db.run("DELETE FROM errors WHERE id = ?", [id]);
  return true;
}
