import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { type AskQuestion, type AskUserResult, parseAskAnswerBody } from "../core/ask-user.js";
import { log } from "../core/logger.js";
import { readCappedBody } from "../utils/http-body.js";

/**
 * Phone control (contract v1): a small local API the pew2 phone daemon uses to
 * open a conversation in an app window and type into it live. Only live while
 * the "Phone control" app setting is on; every `/phone/*` route 404s otherwise.
 *
 * The daemon owns this module. Window work it cannot do itself goes out two
 * ways: per-window `phone_*` SSE frames the webview acts on (draft, send,
 * abort), and `GG_APP_PHONE <json>` stdout lines the Rust shell acts on (open a
 * window, focus one, close one). The shell reports a phone-opened window's new
 * session back on `POST /phone-shell/opened` (app token, not the phone token).
 */

export type PhoneWindowMode = "code" | "goal" | "chat" | "motion";

export interface PhoneWindowInfo {
  sessionId: string;
  cwd: string;
  mode: PhoneWindowMode;
  sessionPath: string | null;
  agentSessionId: string | null;
  busy: boolean;
  focused: boolean;
  /** The plan waiting in the window's Accept / Feedback / Reject box (v1.1). */
  plan: PhonePlan | null;
  /** The window is in plan mode. */
  planMode: boolean;
  /** The window's open `ask_user` questions, oldest first (v1.2). */
  asks: PhoneAsk[];
}

/** One open `ask_user` card: the tool's own question payload. */
export interface PhoneAsk {
  id: string;
  questions: AskQuestion[];
}

export interface PhonePlan {
  planPath: string;
  content: string;
  generation: number;
}

export type PhonePlanDecision = "accept" | "feedback" | "reject";

/** What `GG_APP_PHONE` lines ask the Rust shell to do. */
export type PhoneShellCommand =
  | {
      op: "open";
      requestId: string;
      mode: "code" | "chat" | "motion";
      cwd: string;
      sessionPath: string | null;
    }
  | { op: "focus"; sessionId: string }
  | { op: "close"; sessionId: string };

export interface PhoneControlDeps {
  /** `~/.gg/gg-app-phone.json`. */
  discoveryFile: string;
  appVersion: string;
  pid: number;
  listWindows: () => PhoneWindowInfo[];
  /** Send one SSE frame to a window's webview. */
  relay: (sessionId: string, type: string, data: unknown) => void;
  /**
   * Settle a window's open question exactly as its own card does. False when
   * the id is not open there.
   */
  answerAsk: (sessionId: string, id: string, result: AskUserResult) => boolean;
  /** Hand a window command to the Rust shell. */
  shell: (command: PhoneShellCommand) => void;
  /** Find a conversation file by its id (in `cwd` first). */
  findSessionById: (agentSessionId: string, cwd: string) => Promise<string | null>;
  openTimeoutMs?: number;
  /** How long `/phone/plan` accept waits for the fresh conversation. */
  planAcceptTimeoutMs?: number;
  pingIntervalMs?: number;
  windowsPollMs?: number;
}

export interface PhoneControl {
  readonly enabled: boolean;
  readonly token: string;
  setEnabled: (enabled: boolean) => void;
  /** The daemon's port, once it is listening. */
  setPort: (port: number) => void;
  /** `/phone/*` and `/phone-shell/*` routes. Returns true when handled. */
  handle: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: string,
    method: string,
    appTokenOk: boolean,
  ) => boolean;
  /** The webview reported a hand edit of its composer, or focus. */
  report: (sessionId: string, report: { draft?: string; focused?: boolean }) => void;
  focusedOf: (sessionId: string) => boolean;
  windowsChanged: () => void;
  /** A window's offered plan appeared, changed or went away. */
  planChanged: (sessionId: string, plan: PhonePlan | null) => void;
  /** A window's open questions, after any change (opened, answered, closed). */
  asksChanged: (sessionId: string, asks: PhoneAsk[]) => void;
  sessionClosed: (sessionId: string) => void;
  /** Clean exit: drop the discovery file and close streams. */
  dispose: () => void;
}

export function phoneDiscoveryFile(): string {
  return path.join(os.homedir(), ".gg", "gg-app-phone.json");
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function tokenMatches(given: unknown, expected: string): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = raw ? JSON.parse(raw) : {};
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function windowsSignature(windows: PhoneWindowInfo[]): string {
  return JSON.stringify(
    windows
      .map((w) => [w.sessionId, w.cwd, w.mode, w.sessionPath, w.agentSessionId])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}

export function createPhoneControl(deps: PhoneControlDeps): PhoneControl {
  const token = randomBytes(32).toString("hex");
  const openTimeoutMs = deps.openTimeoutMs ?? 60_000;
  let enabled = false;
  let port: number | null = null;
  const clients = new Set<http.ServerResponse>();
  const focused = new Map<string, boolean>();
  /** Per window: ids of the open questions last reported (v1.2). */
  const openAskIds = new Map<string, Set<string>>();
  const pendingOpens = new Map<
    string,
    { resolve: (result: { sessionId: string } | { error: string }) => void }
  >();
  let lastSignature = "";
  let ping: NodeJS.Timeout | null = null;
  let poll: NodeJS.Timeout | null = null;

  function writeDiscovery(): void {
    if (!enabled || port === null) return;
    const body = JSON.stringify({
      version: 1,
      port,
      token,
      pid: deps.pid,
      appVersion: deps.appVersion,
    });
    try {
      fs.mkdirSync(path.dirname(deps.discoveryFile), { recursive: true });
      const tmp = `${deps.discoveryFile}.${deps.pid}.tmp`;
      fs.writeFileSync(tmp, body, { mode: 0o600 });
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, deps.discoveryFile);
    } catch (err) {
      log("WARN", "phone-control", "failed to write discovery file", { err: String(err) });
    }
  }

  function removeDiscovery(): void {
    try {
      const current = JSON.parse(fs.readFileSync(deps.discoveryFile, "utf-8")) as {
        pid?: unknown;
      };
      // Another app instance's file is not ours to remove.
      if (current.pid !== deps.pid) return;
    } catch {
      // Missing or unreadable: nothing of ours to keep.
    }
    try {
      fs.rmSync(deps.discoveryFile, { force: true });
    } catch {
      /* best effort */
    }
  }

  function emit(event: Record<string, unknown>): void {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const c of clients) c.write(frame);
  }

  function startTimers(): void {
    if (ping) return;
    ping = setInterval(() => {
      for (const c of clients) c.write(": ping\n\n");
    }, deps.pingIntervalMs ?? 15_000);
    ping.unref?.();
    // A window changing conversation (new session, first prompt of a fresh
    // one) has no single hook here, so compare a cheap signature.
    lastSignature = windowsSignature(deps.listWindows());
    poll = setInterval(() => {
      const sig = windowsSignature(deps.listWindows());
      if (sig !== lastSignature) {
        lastSignature = sig;
        emit({ type: "windows" });
      }
    }, deps.windowsPollMs ?? 1_000);
    poll.unref?.();
  }

  function stopTimers(): void {
    if (ping) clearInterval(ping);
    if (poll) clearInterval(poll);
    ping = null;
    poll = null;
  }

  function closeClients(): void {
    for (const c of clients) c.end();
    clients.clear();
  }

  function windowOf(sessionId: unknown): PhoneWindowInfo | undefined {
    if (typeof sessionId !== "string") return undefined;
    return deps.listWindows().find((w) => w.sessionId === sessionId);
  }

  function readJson(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    then: (body: Record<string, unknown>) => void | Promise<void>,
  ): void {
    void readCappedBody(req, res).then(async (raw) => {
      if (raw === null) return;
      const body = parseObject(raw);
      if (!body) {
        send(res, 400, { error: "invalid JSON body" });
        return;
      }
      try {
        await then(body);
      } catch (err) {
        log("ERROR", "phone-control", "request failed", { err: String(err) });
        if (!res.headersSent) send(res, 500, { error: "internal error" });
      }
    });
  }

  /** Body with a known window's sessionId, else answer 404/400 and return null. */
  function withWindow(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    then: (win: PhoneWindowInfo, body: Record<string, unknown>) => void,
  ): void {
    readJson(req, res, (body) => {
      const win = windowOf(body.sessionId);
      if (!win) {
        send(res, 404, { error: "unknown session" });
        return;
      }
      then(win, body);
    });
  }

  async function open(body: Record<string, unknown>, res: http.ServerResponse): Promise<void> {
    const cwd = body.cwd;
    if (typeof cwd !== "string" || !path.isAbsolute(cwd)) {
      send(res, 400, { error: "cwd must be an absolute path" });
      return;
    }
    let sessionPath =
      typeof body.sessionPath === "string" && body.sessionPath ? body.sessionPath : null;
    const agentSessionId =
      typeof body.agentSessionId === "string" && body.agentSessionId ? body.agentSessionId : null;
    if (sessionPath !== null && !path.isAbsolute(sessionPath)) {
      send(res, 400, { error: "sessionPath must be an absolute path" });
      return;
    }
    // A Goal is a code session whose cwd is the goal's folder; chat/motion
    // pass through; anything else is the coding agent.
    const mode = body.mode === "chat" || body.mode === "motion" ? body.mode : "code";

    if (sessionPath !== null || agentSessionId !== null) {
      const target = sessionPath !== null ? path.resolve(sessionPath) : null;
      const existing = deps
        .listWindows()
        .find(
          (w) =>
            (target !== null && w.sessionPath !== null && path.resolve(w.sessionPath) === target) ||
            (agentSessionId !== null && w.agentSessionId === agentSessionId),
        );
      if (existing) {
        deps.shell({ op: "focus", sessionId: existing.sessionId });
        send(res, 200, {
          sessionId: existing.sessionId,
          sessionPath: existing.sessionPath,
          agentSessionId: existing.agentSessionId,
        });
        return;
      }
      if (sessionPath === null && agentSessionId !== null) {
        sessionPath = await deps.findSessionById(agentSessionId, cwd);
        if (sessionPath === null) {
          send(res, 404, { error: "unknown conversation" });
          return;
        }
      }
    }

    const requestId = randomUUID();
    const result = await new Promise<{ sessionId: string } | { error: string }>((resolve) => {
      const timer = setTimeout(() => {
        pendingOpens.delete(requestId);
        resolve({ error: "timed out waiting for the window" });
      }, openTimeoutMs);
      timer.unref?.();
      pendingOpens.set(requestId, {
        resolve: (r) => {
          clearTimeout(timer);
          pendingOpens.delete(requestId);
          resolve(r);
        },
      });
      deps.shell({ op: "open", requestId, mode, cwd, sessionPath });
    });
    if ("error" in result) {
      send(res, 504, { error: result.error });
      return;
    }
    const win = windowOf(result.sessionId);
    send(res, 200, {
      sessionId: result.sessionId,
      sessionPath: win?.sessionPath ?? null,
      agentSessionId: win?.agentSessionId ?? null,
    });
  }

  async function decidePlan(
    win: PhoneWindowInfo,
    body: Record<string, unknown>,
    res: http.ServerResponse,
  ): Promise<void> {
    const decision = body.decision;
    if (decision !== "accept" && decision !== "feedback" && decision !== "reject") {
      send(res, 400, { error: "decision must be accept, feedback or reject" });
      return;
    }
    if (body.generation !== undefined && !Number.isInteger(body.generation)) {
      send(res, 400, { error: "generation must be an integer" });
      return;
    }
    const feedback = typeof body.feedback === "string" ? body.feedback.trim() : "";
    if (decision === "feedback" && !feedback) {
      send(res, 400, { error: "feedback must be a non-empty string" });
      return;
    }
    if (win.plan === null) {
      send(res, 409, { error: "no plan" });
      return;
    }
    if (body.generation !== undefined && body.generation !== win.plan.generation) {
      send(res, 409, { error: "stale plan" });
      return;
    }
    const before = win.agentSessionId;
    // The window runs its own button logic, so laptop and phone stay in step.
    deps.relay(win.sessionId, "phone_plan", {
      decision,
      ...(decision === "feedback" ? { feedback } : {}),
    });
    if (decision !== "accept") {
      send(res, 200, { ok: true, agentSessionId: before });
      return;
    }
    // Accept starts a fresh conversation; answer with it once it exists.
    const deadline = Date.now() + (deps.planAcceptTimeoutMs ?? 10_000);
    for (;;) {
      const now = windowOf(win.sessionId);
      if (!now) break;
      if (now.agentSessionId !== null && now.agentSessionId !== before) {
        send(res, 200, { ok: true, agentSessionId: now.agentSessionId });
        return;
      }
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    send(res, 200, { ok: true, agentSessionId: null });
  }

  function handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: string,
    method: string,
    appTokenOk: boolean,
  ): boolean {
    const pathname = url.split("?")[0] ?? url;

    // The shell's callback for a window it opened for `/phone/open`.
    if (pathname === "/phone-shell/opened") {
      if (!appTokenOk) {
        send(res, 401, { error: "unauthorized" });
        return true;
      }
      if (method !== "POST") {
        send(res, 404, { error: "not found" });
        return true;
      }
      readJson(req, res, (body) => {
        const pending =
          typeof body.requestId === "string" ? pendingOpens.get(body.requestId) : undefined;
        if (pending) {
          if (typeof body.sessionId === "string" && body.sessionId) {
            pending.resolve({ sessionId: body.sessionId });
          } else {
            pending.resolve({
              error: typeof body.error === "string" ? body.error : "window failed to open",
            });
          }
        }
        send(res, 200, { ok: true });
      });
      return true;
    }

    if (pathname !== "/phone" && !pathname.startsWith("/phone/")) return false;
    if (!enabled) {
      send(res, 404, { error: "not found" });
      return true;
    }
    if (!tokenMatches(req.headers["x-gg-phone-token"], token)) {
      send(res, 401, { error: "unauthorized" });
      return true;
    }

    const route = `${method} ${pathname}`;
    switch (route) {
      case "GET /phone/ping":
        send(res, 200, { ok: true, appVersion: deps.appVersion });
        return true;
      case "GET /phone/windows":
        send(res, 200, { windows: deps.listWindows() });
        return true;
      case "GET /phone/events": {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(": connected\n\n");
        clients.add(res);
        startTimers();
        req.on("close", () => {
          clients.delete(res);
          if (clients.size === 0) stopTimers();
        });
        return true;
      }
      case "POST /phone/open":
        readJson(req, res, (body) => open(body, res));
        return true;
      case "POST /phone/draft":
        withWindow(req, res, (win, body) => {
          if (typeof body.text !== "string") {
            send(res, 400, { error: "text must be a string" });
            return;
          }
          deps.relay(win.sessionId, "phone_draft", { text: body.text });
          send(res, 200, { ok: true });
        });
        return true;
      case "POST /phone/send":
        withWindow(req, res, (win, body) => {
          if (typeof body.text !== "string") {
            send(res, 400, { error: "text must be a string" });
            return;
          }
          deps.relay(win.sessionId, "phone_send", { text: body.text });
          send(res, 200, { ok: true });
        });
        return true;
      case "POST /phone/abort":
        withWindow(req, res, (win) => {
          deps.relay(win.sessionId, "phone_abort", {});
          send(res, 200, { ok: true });
        });
        return true;
      case "POST /phone/plan":
        withWindow(req, res, (win, body) => {
          void decidePlan(win, body, res);
        });
        return true;
      case "POST /phone/ask":
        withWindow(req, res, (win, body) => {
          if (typeof body.id !== "string" || !body.id) {
            send(res, 400, { error: "id must be a non-empty string" });
            return;
          }
          const parsed = parseAskAnswerBody(body);
          if (!parsed.ok) {
            send(res, 400, { error: parsed.error });
            return;
          }
          if (!deps.answerAsk(win.sessionId, body.id, parsed.result)) {
            send(res, 409, { error: "no question is awaiting an answer" });
            return;
          }
          send(res, 200, { ok: true });
        });
        return true;
      case "POST /phone/close":
        withWindow(req, res, (win) => {
          deps.shell({ op: "close", sessionId: win.sessionId });
          send(res, 200, { ok: true });
        });
        return true;
      default:
        send(res, 404, { error: "not found" });
        return true;
    }
  }

  return {
    get enabled() {
      return enabled;
    },
    token,
    setEnabled(next) {
      if (next === enabled) return;
      enabled = next;
      if (enabled) {
        writeDiscovery();
      } else {
        removeDiscovery();
        stopTimers();
        closeClients();
      }
    },
    setPort(p) {
      port = p;
      writeDiscovery();
    },
    handle,
    report(sessionId, report) {
      if (typeof report.focused === "boolean") focused.set(sessionId, report.focused);
      if (enabled && typeof report.draft === "string") {
        emit({ type: "draft", sessionId, text: report.draft });
      }
    },
    focusedOf: (sessionId) => focused.get(sessionId) ?? false,
    windowsChanged() {
      if (!enabled) return;
      lastSignature = windowsSignature(deps.listWindows());
      emit({ type: "windows" });
    },
    planChanged(sessionId, plan) {
      if (!enabled) return;
      emit({ type: "plan", sessionId, plan });
    },
    asksChanged(sessionId, asks) {
      // Diff against what was last reported, so each question opens and
      // closes exactly once on the stream. Tracked while off too, so turning
      // the setting on mid-question does not replay it as new.
      const before = openAskIds.get(sessionId) ?? new Set<string>();
      const now = new Set(asks.map((a) => a.id));
      if (now.size === 0) openAskIds.delete(sessionId);
      else openAskIds.set(sessionId, now);
      if (!enabled) return;
      const closedIds = [...before].filter((id) => !now.has(id));
      if (closedIds.length > 0) emit({ type: "ask_closed", sessionId, ids: closedIds });
      for (const ask of asks) {
        if (!before.has(ask.id)) emit({ type: "ask", sessionId, ask });
      }
    },
    sessionClosed(sessionId) {
      focused.delete(sessionId);
      openAskIds.delete(sessionId);
      if (!enabled) return;
      emit({ type: "closed", sessionId });
      lastSignature = windowsSignature(deps.listWindows());
      emit({ type: "windows" });
    },
    dispose() {
      stopTimers();
      closeClients();
      for (const p of pendingOpens.values()) p.resolve({ error: "app is quitting" });
      removeDiscovery();
    },
  };
}
