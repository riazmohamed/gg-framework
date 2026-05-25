import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadTasks,
  saveTasks,
  getNextPendingTask,
  setTaskStatus,
  projectTaskDir,
  type Task,
} from "./task-store.js";

function freshTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    title: overrides.title ?? "Title",
    prompt: overrides.prompt ?? "Prompt",
    status: overrides.status ?? "pending",
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    ...overrides,
  };
}

describe("task-store", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "task-store-test-"));
    rmSync(projectTaskDir(cwd), { recursive: true, force: true });
  });

  it("loadTasks returns empty when no file", async () => {
    expect(await loadTasks(cwd)).toEqual([]);
  });

  it("saveTasks + loadTasks roundtrips", async () => {
    const tasks = [freshTask({ id: "a" }), freshTask({ id: "b" })];
    await saveTasks(cwd, tasks);
    const loaded = await loadTasks(cwd);
    expect(loaded.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("getNextPendingTask skips in-progress and done", async () => {
    await saveTasks(cwd, [
      freshTask({ id: "1", status: "done" }),
      freshTask({ id: "2", status: "in-progress" }),
      freshTask({ id: "3", status: "pending" }),
      freshTask({ id: "4", status: "pending" }),
    ]);
    const next = await getNextPendingTask(cwd);
    expect(next?.id).toBe("3");
  });

  it("getNextPendingTask returns null when none pending", async () => {
    await saveTasks(cwd, [freshTask({ id: "1", status: "done" })]);
    expect(await getNextPendingTask(cwd)).toBeNull();
  });

  it("setTaskStatus mutates only the target task", async () => {
    await saveTasks(cwd, [
      freshTask({ id: "a", status: "pending" }),
      freshTask({ id: "b", status: "pending" }),
    ]);
    await setTaskStatus(cwd, "a", "in-progress");
    const loaded = await loadTasks(cwd);
    expect(loaded.find((t) => t.id === "a")?.status).toBe("in-progress");
    expect(loaded.find((t) => t.id === "b")?.status).toBe("pending");
  });

  it("simulates run-all loop draining pending tasks", async () => {
    await saveTasks(cwd, [
      freshTask({ id: "1", status: "pending", prompt: "p1" }),
      freshTask({ id: "2", status: "pending", prompt: "p2" }),
      freshTask({ id: "3", status: "done" }),
    ]);
    const ranPrompts: string[] = [];
    let next = await getNextPendingTask(cwd);
    while (next) {
      await setTaskStatus(cwd, next.id, "in-progress");
      ranPrompts.push(next.prompt);
      await setTaskStatus(cwd, next.id, "done");
      next = await getNextPendingTask(cwd);
    }
    expect(ranPrompts).toEqual(["p1", "p2"]);
    const final = await loadTasks(cwd);
    expect(final.every((t) => t.status === "done")).toBe(true);
  });
});
