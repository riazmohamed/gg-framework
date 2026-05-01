CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  key         TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS errors (
  id                TEXT PRIMARY KEY,
  last_event_id     TEXT,
  project_id        TEXT NOT NULL,
  fingerprint       TEXT NOT NULL,
  status            TEXT NOT NULL,
  type              TEXT,
  message           TEXT,
  stack             TEXT,
  code_context      TEXT,
  runtime           TEXT,
  occurrences       INTEGER NOT NULL DEFAULT 1,
  recurrence_count  INTEGER NOT NULL DEFAULT 0,
  first_seen_at     INTEGER NOT NULL,
  last_seen_at      INTEGER NOT NULL,
  fixed_at          INTEGER,
  merged_at         INTEGER,
  branch            TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS errors_project_fingerprint
  ON errors(project_id, fingerprint);

CREATE INDEX IF NOT EXISTS errors_project_status
  ON errors(project_id, status);

CREATE INDEX IF NOT EXISTS errors_decay
  ON errors(status, merged_at);
