import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isInboxId, listInbox, removeInboxItem } from "./app-inbox.js";

let root: string;
let dir: string;
let project: string;

function leave(id: string, body: unknown, at = 1_000): void {
  const file = path.join(dir, `${id}.json`);
  fs.writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
  fs.utimesSync(file, at, at);
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gg-inbox-")));
  dir = path.join(root, "inbox");
  project = path.join(root, "project");
  fs.mkdirSync(dir);
  fs.mkdirSync(project);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("app inbox", () => {
  it("lists only this project's messages, oldest first", () => {
    leave(
      "b",
      { cwd: project, title: "Second", text: "/autopilot take 2", from: "Autopilot" },
      2_000,
    );
    leave("a", { cwd: project, text: "/autopilot take 1" }, 1_000);
    leave("other", { cwd: path.join(root, "elsewhere"), text: "not here" });
    expect(listInbox(dir, project)).toEqual([
      {
        id: "a",
        from: "Inbox",
        title: "/autopilot take 1",
        text: "/autopilot take 1",
        createdAt: 1_000_000,
      },
      {
        id: "b",
        from: "Autopilot",
        title: "Second",
        text: "/autopilot take 2",
        createdAt: 2_000_000,
      },
    ]);
  });

  it("matches the project through a symlink or a trailing slash", () => {
    const link = path.join(root, "link");
    fs.symlinkSync(project, link);
    leave("a", { cwd: `${link}/`, text: "hi" });
    expect(listInbox(dir, project).map((item) => item.id)).toEqual(["a"]);
  });

  it("skips anything malformed, oversized or badly named", () => {
    leave("bad-json", "{not json");
    leave("no-text", { cwd: project, text: "  " });
    leave("relative", { cwd: "project", text: "hi" });
    leave("huge", { cwd: project, text: "x".repeat(5_000) });
    fs.writeFileSync(path.join(dir, "..hidden.json"), JSON.stringify({ cwd: project, text: "hi" }));
    fs.writeFileSync(path.join(dir, "note.txt"), "hi");
    expect(listInbox(dir, project)).toEqual([]);
    expect(listInbox(path.join(root, "missing"), project)).toEqual([]);
  });

  it("removes a message only for its own project and only by a safe id", () => {
    leave("a", { cwd: project, text: "hi" });
    leave("other", { cwd: root, text: "hi" });
    expect(removeInboxItem(dir, project, "other")).toBe(false);
    expect(removeInboxItem(dir, project, "../inbox/a")).toBe(false);
    expect(removeInboxItem(dir, project, "a")).toBe(true);
    expect(fs.existsSync(path.join(dir, "a.json"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "other.json"))).toBe(true);
    expect(isInboxId("autopilot-20261104-125806-64e8e5")).toBe(true);
    expect(isInboxId("a/b")).toBe(false);
  });
});
