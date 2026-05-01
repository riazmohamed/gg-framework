export type Status = "open" | "in_progress" | "awaiting_review" | "merged" | "failed";

export interface ProjectRow {
  id: string;
  name: string;
  key: string;
  secret: string | null;
  created_at: number;
}

export interface ErrorRow {
  id: string;
  last_event_id: string | null;
  project_id: string;
  fingerprint: string;
  status: Status;
  type: string | null;
  message: string | null;
  stack: string | null;
  code_context: string | null;
  runtime: string | null;
  occurrences: number;
  recurrence_count: number;
  first_seen_at: number;
  last_seen_at: number;
  fixed_at: number | null;
  merged_at: number | null;
  branch: string | null;
}

export interface WireEvent {
  event_id: string;
  project_key: string;
  fingerprint: string;
  type: string;
  message: string;
  stack: unknown;
  code_context: unknown;
  runtime: string;
  manual_report: boolean;
  level: "error" | "warning" | "fatal";
  occurred_at: string;
}

export interface PatchErrorBody {
  status?: Status;
  branch?: string;
}

export interface Db {
  one<T>(sql: string, params?: unknown[]): Promise<T | null>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<void>;
}

export interface AppEnv {
  Bindings: { DB: D1Database };
  Variables: { project: ProjectRow };
}
