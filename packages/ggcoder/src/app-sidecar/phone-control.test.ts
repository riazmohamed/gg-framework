import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPhoneControl,
  type PhoneControl,
  type PhoneShellCommand,
  type PhoneWindowInfo,
} from "./phone-control.js";
import type { AskQuestion, AskUserResult } from "../core/ask-user.js";

const APP_TOKEN = "app-token";

interface Harness {
  phone: PhoneControl;
  base: string;
  file: string;
  windows: PhoneWindowInfo[];
  relayed: { sessionId: string; type: string; data: unknown }[];
  shell: PhoneShellCommand[];
  /** Open question ids per window; answerAsk settles (removes) them. */
  openAsks: Map<string, Set<string>>;
  settled: { sessionId: string; id: string; result: AskUserResult }[];
  close: () => Promise<void>;
}

const open: Harness[] = [];

function win(sessionId: string, extra: Partial<PhoneWindowInfo> = {}): PhoneWindowInfo {
  return {
    sessionId,
    cwd: "/p",
    mode: "code",
    sessionPath: null,
    agentSessionId: null,
    busy: false,
    focused: false,
    plan: null,
    planMode: false,
    asks: [],
    ...extra,
  };
}

async function harness(enabled = true): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phone-"));
  const file = path.join(dir, "gg-app-phone.json");
  const windows: PhoneWindowInfo[] = [];
  const relayed: Harness["relayed"] = [];
  const shell: PhoneShellCommand[] = [];
  const openAsks = new Map<string, Set<string>>();
  const settled: Harness["settled"] = [];
  const phone = createPhoneControl({
    discoveryFile: file,
    appVersion: "0.97.5",
    pid: process.pid,
    listWindows: () => windows,
    relay: (sessionId, type, data) => relayed.push({ sessionId, type, data }),
    answerAsk: (sessionId, id, result) => {
      if (!openAsks.get(sessionId)?.delete(id)) return false;
      settled.push({ sessionId, id, result });
      return true;
    },
    shell: (c) => shell.push(c),
    findSessionById: async (id) => (id === "conv-9" ? "/s/conv-9.jsonl" : null),
    windowsPollMs: 20,
    planAcceptTimeoutMs: 300,
  });
  const server = http.createServer((req, res) => {
    if (
      phone.handle(
        req,
        res,
        req.url ?? "/",
        req.method ?? "GET",
        req.headers["x-gg-token"] === APP_TOKEN,
      )
    )
      return;
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  phone.setEnabled(enabled);
  phone.setPort(port);
  const h: Harness = {
    phone,
    base: `http://127.0.0.1:${port}`,
    file,
    windows,
    relayed,
    shell,
    openAsks,
    settled,
    close: async () => {
      phone.dispose();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  open.push(h);
  return h;
}

afterEach(async () => {
  for (const h of open.splice(0)) await h.close();
});

function call(h: Harness, method: string, route: string, body?: unknown, token = h.phone.token) {
  return fetch(`${h.base}${route}`, {
    method,
    headers: { "x-gg-phone-token": token, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("phone control discovery file", () => {
  it("is written 0600 with the contract fields while on, and removed when off", async () => {
    const h = await harness();
    const content = JSON.parse(fs.readFileSync(h.file, "utf-8")) as Record<string, unknown>;
    expect(content).toEqual({
      version: 1,
      port: Number(new URL(h.base).port),
      token: h.phone.token,
      pid: process.pid,
      appVersion: "0.97.5",
    });
    expect(h.phone.token).toMatch(/^[0-9a-f]{64}$/);
    if (process.platform !== "win32") expect(fs.statSync(h.file).mode & 0o777).toBe(0o600);
    h.phone.setEnabled(false);
    expect(fs.existsSync(h.file)).toBe(false);
    h.phone.setEnabled(true);
    expect(fs.existsSync(h.file)).toBe(true);
    h.phone.dispose();
    expect(fs.existsSync(h.file)).toBe(false);
  });

  it("is not written while off", async () => {
    const h = await harness(false);
    expect(fs.existsSync(h.file)).toBe(false);
  });
});

describe("phone control routes", () => {
  it("404s every route while off", async () => {
    const h = await harness(false);
    expect((await call(h, "GET", "/phone/ping")).status).toBe(404);
    expect((await call(h, "POST", "/phone/draft", { sessionId: "a", text: "x" })).status).toBe(404);
  });

  it("401s a wrong or missing token", async () => {
    const h = await harness();
    expect((await call(h, "GET", "/phone/ping", undefined, "nope")).status).toBe(401);
    expect((await fetch(`${h.base}/phone/ping`)).status).toBe(401);
    // The app's own token is not a phone token.
    const res = await fetch(`${h.base}/phone/ping`, { headers: { "x-gg-token": APP_TOKEN } });
    expect(res.status).toBe(401);
  });

  it("answers ping and lists windows", async () => {
    const h = await harness();
    h.windows.push(win("a", { mode: "goal", busy: true }));
    expect(await (await call(h, "GET", "/phone/ping")).json()).toEqual({
      ok: true,
      appVersion: "0.97.5",
    });
    expect(await (await call(h, "GET", "/phone/windows")).json()).toEqual({
      windows: [win("a", { mode: "goal", busy: true })],
    });
  });

  it("relays draft, send and abort to the window, and close to the shell", async () => {
    const h = await harness();
    h.windows.push(win("a"));
    for (const [route, body] of [
      ["/phone/draft", { sessionId: "a", text: "hi" }],
      ["/phone/send", { sessionId: "a", text: "go" }],
      ["/phone/abort", { sessionId: "a" }],
      ["/phone/close", { sessionId: "a" }],
    ] as const) {
      const res = await call(h, "POST", route, body);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    expect(h.relayed).toEqual([
      { sessionId: "a", type: "phone_draft", data: { text: "hi" } },
      { sessionId: "a", type: "phone_send", data: { text: "go" } },
      { sessionId: "a", type: "phone_abort", data: {} },
    ]);
    expect(h.shell).toEqual([{ op: "close", sessionId: "a" }]);
  });

  it("404s an unknown session", async () => {
    const h = await harness();
    const res = await call(h, "POST", "/phone/draft", { sessionId: "zz", text: "x" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown session" });
  });

  it("focuses the window already showing a conversation", async () => {
    const h = await harness();
    h.windows.push(win("a", { sessionPath: "/s/c.jsonl", agentSessionId: "c" }));
    const res = await call(h, "POST", "/phone/open", { cwd: "/p", agentSessionId: "c" });
    expect(await res.json()).toEqual({
      sessionId: "a",
      sessionPath: "/s/c.jsonl",
      agentSessionId: "c",
    });
    expect(h.shell).toEqual([{ op: "focus", sessionId: "a" }]);
  });

  it("opens a new window through the shell and returns once its session exists", async () => {
    const h = await harness();
    const pending = call(h, "POST", "/phone/open", {
      cwd: "/p",
      agentSessionId: "conv-9",
      mode: "goal",
    });
    await expect.poll(() => h.shell.length).toBe(1);
    const cmd = h.shell[0];
    expect(cmd).toMatchObject({
      op: "open",
      mode: "code",
      cwd: "/p",
      sessionPath: "/s/conv-9.jsonl",
    });
    if (cmd?.op !== "open") throw new Error("expected open");
    h.windows.push(win("new", { sessionPath: "/s/conv-9.jsonl", agentSessionId: "conv-9" }));
    // The shell's callback needs the app token.
    const denied = await fetch(`${h.base}/phone-shell/opened`, {
      method: "POST",
      body: JSON.stringify({ requestId: cmd.requestId, sessionId: "new" }),
    });
    expect(denied.status).toBe(401);
    await fetch(`${h.base}/phone-shell/opened`, {
      method: "POST",
      headers: { "x-gg-token": APP_TOKEN },
      body: JSON.stringify({ requestId: cmd.requestId, sessionId: "new" }),
    });
    expect(await (await pending).json()).toEqual({
      sessionId: "new",
      sessionPath: "/s/conv-9.jsonl",
      agentSessionId: "conv-9",
    });
  });

  it("streams draft, windows and closed events", async () => {
    const h = await harness();
    const res = await call(h, "GET", "/phone/events");
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader();
    const events: unknown[] = [];
    const decoder = new TextDecoder();
    let buf = "";
    const readUntil = async (n: number) => {
      while (events.length < n) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value);
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (frame.startsWith("data: ")) events.push(JSON.parse(frame.slice(6)));
        }
      }
    };
    h.phone.report("a", { draft: "typed" });
    h.windows.push(win("b"));
    await readUntil(2); // the poll notices the new window
    h.phone.sessionClosed("b");
    await readUntil(3);
    await reader.cancel();
    expect(events.slice(0, 3)).toEqual([
      { type: "draft", sessionId: "a", text: "typed" },
      { type: "windows" },
      { type: "closed", sessionId: "b" },
    ]);
  });
});

describe("phone control plan review (v1.1)", () => {
  const plan = { planPath: "/p/.gg/plans/x.md", content: "# Plan", generation: 3 };

  it("lists the offered plan and plan mode", async () => {
    const h = await harness();
    h.windows.push(win("a", { plan, planMode: false }), win("b", { planMode: true }));
    const body = (await (await call(h, "GET", "/phone/windows")).json()) as {
      windows: PhoneWindowInfo[];
    };
    expect(body.windows.map((w) => [w.plan, w.planMode])).toEqual([
      [plan, false],
      [null, true],
    ]);
  });

  it("validates decisions: no plan, stale plan, empty feedback", async () => {
    const h = await harness();
    h.windows.push(win("a"));
    let res = await call(h, "POST", "/phone/plan", { sessionId: "a", decision: "accept" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "no plan" });
    h.windows[0] = win("a", { plan });
    res = await call(h, "POST", "/phone/plan", {
      sessionId: "a",
      decision: "reject",
      generation: 2,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "stale plan" });
    res = await call(h, "POST", "/phone/plan", {
      sessionId: "a",
      decision: "feedback",
      feedback: " ",
    });
    expect(res.status).toBe(400);
    res = await call(h, "POST", "/phone/plan", { sessionId: "a", decision: "maybe" });
    expect(res.status).toBe(400);
    res = await call(h, "POST", "/phone/plan", { sessionId: "zz", decision: "accept" });
    expect(res.status).toBe(404);
    expect(h.relayed).toEqual([]);
  });

  it("relays feedback and reject to the window", async () => {
    const h = await harness();
    h.windows.push(win("a", { plan, agentSessionId: "c1", sessionPath: "/s/c1.jsonl" }));
    let res = await call(h, "POST", "/phone/plan", {
      sessionId: "a",
      decision: "feedback",
      feedback: "smaller steps",
      generation: 3,
    });
    expect(await res.json()).toEqual({ ok: true, agentSessionId: "c1" });
    res = await call(h, "POST", "/phone/plan", { sessionId: "a", decision: "reject" });
    expect(await res.json()).toEqual({ ok: true, agentSessionId: "c1" });
    expect(h.relayed).toEqual([
      {
        sessionId: "a",
        type: "phone_plan",
        data: { decision: "feedback", feedback: "smaller steps" },
      },
      { sessionId: "a", type: "phone_plan", data: { decision: "reject" } },
    ]);
  });

  it("answers accept with the fresh conversation, or null on timeout", async () => {
    const h = await harness();
    h.windows.push(win("a", { plan, agentSessionId: "c1", sessionPath: "/s/c1.jsonl" }));
    const pending = call(h, "POST", "/phone/plan", { sessionId: "a", decision: "accept" });
    await expect.poll(() => h.relayed.length).toBe(1);
    expect(h.relayed[0]).toEqual({
      sessionId: "a",
      type: "phone_plan",
      data: { decision: "accept" },
    });
    h.windows[0] = win("a", { agentSessionId: "c2", sessionPath: "/s/c2.jsonl" });
    expect(await (await pending).json()).toEqual({ ok: true, agentSessionId: "c2" });

    h.windows[0] = win("a", { plan, agentSessionId: "c2" });
    const res = await call(h, "POST", "/phone/plan", { sessionId: "a", decision: "accept" });
    expect(await res.json()).toEqual({ ok: true, agentSessionId: null });
  });

  it("streams plan events", async () => {
    const h = await harness();
    const res = await call(h, "GET", "/phone/events");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const events: unknown[] = [];
    h.phone.planChanged("a", plan);
    h.phone.planChanged("a", null);
    while (events.length < 2) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (frame.startsWith("data: ")) events.push(JSON.parse(frame.slice(6)));
      }
    }
    await reader.cancel();
    expect(events).toEqual([
      { type: "plan", sessionId: "a", plan },
      { type: "plan", sessionId: "a", plan: null },
    ]);
  });
});

describe("phone control questions (v1.2)", () => {
  const questions: AskQuestion[] = [
    {
      id: "next",
      question: "What should I do next?",
      kind: "choice",
      options: [{ label: "Tests" }, { label: "Docs" }, { label: "Ship" }],
    },
  ];

  it("lists a window's open questions", async () => {
    const h = await harness();
    h.windows.push(win("a", { asks: [{ id: "ask-1", questions }] }));
    const body = (await (await call(h, "GET", "/phone/windows")).json()) as {
      windows: PhoneWindowInfo[];
    };
    expect(body.windows[0]?.asks).toEqual([{ id: "ask-1", questions }]);
  });

  it("answers and cancels through the window's settle path", async () => {
    const h = await harness();
    h.windows.push(win("a"));
    h.openAsks.set("a", new Set(["ask-1", "ask-2"]));
    const ok = await call(h, "POST", "/phone/ask", {
      sessionId: "a",
      id: "ask-1",
      action: "answer",
      answers: { next: "Tests", multi: ["x", "y"], bad: 3 },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    const cancel = await call(h, "POST", "/phone/ask", {
      sessionId: "a",
      id: "ask-2",
      action: "cancel",
    });
    expect(cancel.status).toBe(200);
    expect(h.settled).toEqual([
      {
        sessionId: "a",
        id: "ask-1",
        result: { action: "answer", answers: { next: "Tests", multi: ["x", "y"] } },
      },
      { sessionId: "a", id: "ask-2", result: { action: "cancel" } },
    ]);
  });

  it("rejects bad bodies, unknown windows and closed questions", async () => {
    const h = await harness();
    h.windows.push(win("a"));
    h.openAsks.set("a", new Set(["ask-1"]));
    const bad = await call(h, "POST", "/phone/ask", { sessionId: "a", id: "ask-1", action: "x" });
    expect(bad.status).toBe(400);
    const noId = await call(h, "POST", "/phone/ask", { sessionId: "a", action: "cancel" });
    expect(noId.status).toBe(400);
    const unknown = await call(h, "POST", "/phone/ask", {
      sessionId: "zz",
      id: "ask-1",
      action: "cancel",
    });
    expect(unknown.status).toBe(404);
    const closed = await call(h, "POST", "/phone/ask", {
      sessionId: "a",
      id: "ask-9",
      action: "cancel",
    });
    expect(closed.status).toBe(409);
    expect(await closed.json()).toEqual({ error: "no question is awaiting an answer" });
    expect(h.settled).toEqual([]);
  });

  it("streams each question opening and closing once", async () => {
    const h = await harness();
    const res = await call(h, "GET", "/phone/events");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const events: unknown[] = [];
    const one = { id: "ask-1", questions };
    const two = { id: "ask-2", questions };
    h.phone.asksChanged("a", [one]);
    h.phone.asksChanged("a", [one]); // deferred: still open, nothing new
    h.phone.asksChanged("a", [two]); // superseded by a newer question
    h.phone.asksChanged("a", []);
    while (events.length < 4) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (frame.startsWith("data: ")) events.push(JSON.parse(frame.slice(6)));
      }
    }
    await reader.cancel();
    expect(events).toEqual([
      { type: "ask", sessionId: "a", ask: one },
      { type: "ask_closed", sessionId: "a", ids: ["ask-1"] },
      { type: "ask", sessionId: "a", ask: two },
      { type: "ask_closed", sessionId: "a", ids: ["ask-2"] },
    ]);
  });
});
