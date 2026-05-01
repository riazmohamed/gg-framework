import { errorId } from "../ids.js";
import type { Db, ErrorRow, WireEvent } from "../types.js";
import { findProjectByKey } from "./projects.js";

export const INGEST_LIMITS = {
  // Hard cap on the raw POST body before JSON.parse — protects D1 row size
  // and keeps the Worker from chewing CPU on a multi-MB JSON parse.
  totalBody: 64 * 1024,
  message: 4096,
  type: 256,
  fingerprint: 256,
  runtime: 64,
  eventId: 128,
  projectKey: 128,
  // Hard cap on unique fingerprints per project. Replays still update the
  // existing row; only *new* fingerprints fail past this cap. Stops slow-burn
  // D1 bloat from an attacker with the (publishable) project_key.
  uniqueFingerprintsPerProject: 10_000,
  // Allowed level values must match the WireEvent union.
  levels: new Set(["error", "warning", "fatal"]),
} as const;

const PROJECT_KEY_RE = /^pk_(?:live|test)_[A-Za-z0-9_-]{1,128}$/;
const FINGERPRINT_RE = /^[A-Za-z0-9_:.@/-]{1,256}$/;

export type ValidateResult = { ok: true; event: WireEvent } | { ok: false; error: string };

export function validateWireEvent(raw: unknown): ValidateResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "invalid body" };
  const e = raw as Record<string, unknown>;

  if (typeof e.event_id !== "string" || e.event_id.length === 0)
    return { ok: false, error: "invalid event_id" };
  if (e.event_id.length > INGEST_LIMITS.eventId) return { ok: false, error: "event_id too long" };

  if (typeof e.project_key !== "string" || !PROJECT_KEY_RE.test(e.project_key))
    return { ok: false, error: "invalid project_key" };

  if (typeof e.fingerprint !== "string" || !FINGERPRINT_RE.test(e.fingerprint))
    return { ok: false, error: "invalid fingerprint" };

  if (typeof e.type !== "string" || e.type.length > INGEST_LIMITS.type)
    return { ok: false, error: "invalid type" };

  if (typeof e.message !== "string" || e.message.length > INGEST_LIMITS.message)
    return { ok: false, error: "invalid message" };

  if (typeof e.runtime !== "string" || e.runtime.length > INGEST_LIMITS.runtime)
    return { ok: false, error: "invalid runtime" };

  if (typeof e.manual_report !== "boolean") return { ok: false, error: "invalid manual_report" };

  if (typeof e.level !== "string" || !INGEST_LIMITS.levels.has(e.level))
    return { ok: false, error: "invalid level" };

  if (typeof e.occurred_at !== "string" || e.occurred_at.length > 64)
    return { ok: false, error: "invalid occurred_at" };

  // stack/code_context are JSON-shaped but free-form — body cap bounds size.
  return { ok: true, event: e as unknown as WireEvent };
}

export type IngestResult =
  | { kind: "ok"; error: ErrorRow; recurred: boolean; created: boolean }
  | { kind: "duplicate"; error: ErrorRow }
  | { kind: "unknown_project" }
  | { kind: "rejected_cap" };

export async function ingestEvent(db: Db, event: WireEvent): Promise<IngestResult> {
  const project = await findProjectByKey(db, event.project_key);
  if (!project) return { kind: "unknown_project" };

  const existing = await db.one<ErrorRow>(
    "SELECT * FROM errors WHERE project_id = ? AND fingerprint = ?",
    [project.id, event.fingerprint],
  );

  const now = Date.now();
  const stackJson = event.stack ? JSON.stringify(event.stack) : null;
  const ctxJson = event.code_context ? JSON.stringify(event.code_context) : null;

  if (!existing) {
    // Per-project unique-fingerprint cap. Counted only on insert because
    // updates to existing rows are bounded by occurrences, not row count.
    const tally = await db.one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM errors WHERE project_id = ?",
      [project.id],
    );
    if (tally && tally.c >= INGEST_LIMITS.uniqueFingerprintsPerProject) {
      return { kind: "rejected_cap" };
    }
    const row: ErrorRow = {
      id: errorId(),
      last_event_id: event.event_id,
      project_id: project.id,
      fingerprint: event.fingerprint,
      status: "open",
      type: event.type,
      message: event.message,
      stack: stackJson,
      code_context: ctxJson,
      runtime: event.runtime,
      occurrences: 1,
      recurrence_count: 0,
      first_seen_at: now,
      last_seen_at: now,
      fixed_at: null,
      merged_at: null,
      branch: null,
    };
    await db.run(
      `INSERT INTO errors (
         id, last_event_id, project_id, fingerprint, status, type, message, stack,
         code_context, runtime, occurrences, recurrence_count, first_seen_at, last_seen_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
      [
        row.id,
        row.last_event_id,
        row.project_id,
        row.fingerprint,
        row.status,
        row.type,
        row.message,
        row.stack,
        row.code_context,
        row.runtime,
        row.first_seen_at,
        row.last_seen_at,
      ],
    );
    return { kind: "ok", error: row, recurred: false, created: true };
  }

  if (existing.last_event_id === event.event_id) {
    return { kind: "duplicate", error: existing };
  }

  const recurred = existing.status === "merged";
  const newStatus = recurred ? "open" : existing.status;
  const newRecurrenceCount = recurred ? existing.recurrence_count + 1 : existing.recurrence_count;

  await db.run(
    `UPDATE errors
       SET last_event_id = ?,
           occurrences = occurrences + 1,
           last_seen_at = ?,
           status = ?,
           recurrence_count = ?,
           type = ?,
           message = ?,
           stack = ?,
           code_context = ?,
           runtime = ?
     WHERE id = ?`,
    [
      event.event_id,
      now,
      newStatus,
      newRecurrenceCount,
      event.type,
      event.message,
      stackJson,
      ctxJson,
      event.runtime,
      existing.id,
    ],
  );

  const updated: ErrorRow = {
    ...existing,
    last_event_id: event.event_id,
    occurrences: existing.occurrences + 1,
    last_seen_at: now,
    status: newStatus,
    recurrence_count: newRecurrenceCount,
    type: event.type,
    message: event.message,
    stack: stackJson,
    code_context: ctxJson,
    runtime: event.runtime,
  };
  return { kind: "ok", error: updated, recurred, created: false };
}
