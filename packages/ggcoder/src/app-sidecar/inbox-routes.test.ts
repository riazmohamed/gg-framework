import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSessionRoutes } from "./session-routes.js";
import type { SessionRouteContext } from "./route-context.js";

let root: string;
let project: string;
let server: http.Server;
let base: string;
const broadcast = vi.fn();

beforeEach(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gg-inbox-routes-")));
  project = path.join(root, "project");
  fs.mkdirSync(project);
  fs.mkdirSync(path.join(root, "inbox"));
  const ctx = {
    paths: { agentDir: root },
    cwd: project,
    broadcast,
  } as unknown as SessionRouteContext;
  server = http.createServer((req, res) => {
    if (!handleSessionRoutes(ctx, req, res, req.url ?? "/", req.method ?? "GET")) {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  broadcast.mockReset();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
});

function remove(body: string): Promise<Response> {
  return fetch(`${base}/inbox/remove`, { method: "POST", body });
}

describe("POST /inbox/remove", () => {
  it("deletes this project's message and pushes the rest", async () => {
    const file = path.join(root, "inbox", "autopilot-1.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ cwd: project, title: "Fix it", text: "/autopilot take 1" }),
    );
    const res = await remove(JSON.stringify({ id: "autopilot-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true, items: [] });
    expect(fs.existsSync(file)).toBe(false);
    expect(broadcast).toHaveBeenCalledWith("inbox", { items: [] });
  });

  it("refuses a bad id or body and leaves files alone", async () => {
    const file = path.join(root, "inbox", "keep.json");
    fs.writeFileSync(file, JSON.stringify({ cwd: project, text: "hi" }));
    expect((await remove(JSON.stringify({ id: "../inbox/keep" }))).status).toBe(400);
    expect((await remove("{nope")).status).toBe(400);
    expect(fs.existsSync(file)).toBe(true);
  });
});
