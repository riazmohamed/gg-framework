import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { d1Db } from "./db.js";
import { INGEST_LIMITS, ingestEvent, validateWireEvent } from "./handlers/ingest.js";
import {
  countProjectsCreatedSince,
  createProject,
  findProjectBySecret,
} from "./handlers/projects.js";
import { deleteError, getError, listErrors, patchError } from "./handlers/errors.js";
import type { AppEnv, PatchErrorBody } from "./types.js";

const app = new Hono<AppEnv>();

// /ingest is the only browser-callable route — keep it open-CORS so any
// SDK-instrumented site can post events. Every other endpoint is bearer-
// authed and intended for the CLI only, so it gets no CORS headers (calls
// from a browser without CORS will fail by design).
app.use(
  "/ingest",
  cors({
    origin: "*",
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: ["content-type", "x-pixel-key"],
    maxAge: 86400,
  }),
);

const PROJECT_CREATION_WINDOW_MS = 60 * 60 * 1000;
const PROJECT_CREATION_MAX_PER_HOUR = 100;

const SECRET_RE = /^Bearer\s+(sk_live_[a-f0-9]{64})$/;

const requireProjectAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("authorization");
  const match = header ? SECRET_RE.exec(header) : null;
  if (!match) return c.json({ error: "missing or invalid Authorization" }, 401);
  const project = await findProjectBySecret(d1Db(c.env.DB), match[1]!);
  if (!project) return c.json({ error: "invalid secret" }, 401);
  c.set("project", project);
  await next();
};

app.post("/ingest", async (c) => {
  const text = await c.req.text();
  if (text.length > INGEST_LIMITS.totalBody) {
    return c.json({ error: "payload too large" }, 413);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const v = validateWireEvent(raw);
  if (!v.ok) return c.json({ error: v.error }, 400);

  const headerKey = c.req.header("x-pixel-key");
  if (headerKey && headerKey !== v.event.project_key) {
    return c.json({ error: "project_key mismatch" }, 400);
  }

  const result = await ingestEvent(d1Db(c.env.DB), v.event);
  switch (result.kind) {
    case "unknown_project":
      return c.json({ error: "unknown project_key" }, 401);
    case "rejected_cap":
      return c.json({ error: "project fingerprint cap reached" }, 429);
    case "duplicate":
      return c.json({ error_id: result.error.id, duplicate: true });
    case "ok":
      return c.json({
        error_id: result.error.id,
        created: result.created,
        recurred: result.recurred,
      });
  }
});

// Project creation is intentionally open (the CLI of any installed user must
// be able to register a fresh project) but globally rate-limited so a single
// abuser can't fill the table. Recommend a Cloudflare Rate Limiting Rule on
// this path keyed by IP for layered defense.
app.post("/api/projects", async (c) => {
  const since = Date.now() - PROJECT_CREATION_WINDOW_MS;
  const recent = await countProjectsCreatedSince(d1Db(c.env.DB), since);
  if (recent >= PROJECT_CREATION_MAX_PER_HOUR) {
    return c.json({ error: "too many recent project creations — try later" }, 429);
  }
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  if (!body.name || typeof body.name !== "string") {
    return c.json({ error: "name is required" }, 400);
  }
  if (body.name.length > 100) {
    return c.json({ error: "name too long" }, 400);
  }
  const project = await createProject(d1Db(c.env.DB), body.name);
  return c.json(
    { id: project.id, key: project.key, secret: project.secret, name: project.name },
    201,
  );
});

// Bearer auth gate for everything below: project list/read/modify/delete.
app.use("/api/projects/:id/errors", requireProjectAuth);
app.use("/api/errors/:id", requireProjectAuth);

app.get("/api/projects/:id/errors", async (c) => {
  const project = c.get("project");
  if (project.id !== c.req.param("id")) {
    return c.json({ error: "forbidden" }, 403);
  }
  const status = c.req.query("status");
  try {
    const rows = await listErrors(d1Db(c.env.DB), project.id, status);
    return c.json({ errors: rows });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.get("/api/errors/:id", async (c) => {
  const project = c.get("project");
  const row = await getError(d1Db(c.env.DB), c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);
  if (row.project_id !== project.id) return c.json({ error: "forbidden" }, 403);
  return c.json(row);
});

app.patch("/api/errors/:id", async (c) => {
  const project = c.get("project");
  const existing = await getError(d1Db(c.env.DB), c.req.param("id"));
  if (!existing) return c.json({ error: "not found" }, 404);
  if (existing.project_id !== project.id) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<PatchErrorBody>().catch(() => ({}));
  try {
    const row = await patchError(d1Db(c.env.DB), c.req.param("id"), body);
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json(row);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.delete("/api/errors/:id", async (c) => {
  const project = c.get("project");
  const existing = await getError(d1Db(c.env.DB), c.req.param("id"));
  if (!existing) return c.json({ error: "not found" }, 404);
  if (existing.project_id !== project.id) return c.json({ error: "forbidden" }, 403);
  await deleteError(d1Db(c.env.DB), c.req.param("id"));
  return c.json({ deleted: true });
});

app.get("/health", (c) => c.json({ ok: true }));

export default app;
