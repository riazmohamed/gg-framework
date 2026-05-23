import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
EventEmitter.captureRejections = true;
import { PassThrough } from "node:stream";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import type * as FsPromises from "node:fs/promises";
import { projectDir } from "./goal-store.js";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof FsPromises>("node:fs/promises");
  const writeFile = vi.fn(
    (
      file: Parameters<typeof actual.writeFile>[0],
      data: Parameters<typeof actual.writeFile>[1],
      options?: Parameters<typeof actual.writeFile>[2],
    ) => actual.writeFile(file, data, options),
  );

  return { ...actual, writeFile };
});

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 4242;
  kill = vi.fn();
}

let tmpBase: string;
let tmpProject: string;
let child: FakeChild;

beforeEach(async () => {
  vi.useFakeTimers();
  tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "goal-verifier-test-base-"));
  tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), "goal-verifier-test-project-"));
  process.env.GG_GOALS_BASE = tmpBase;
  child = new FakeChild();
  spawnMock.mockReturnValue(child as unknown as ChildProcess);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.clearAllMocks();
  delete process.env.GG_GOALS_BASE;
  await fs.rm(tmpBase, { recursive: true, force: true });
  await fs.rm(tmpProject, { recursive: true, force: true });
});

describe("runGoalVerifierCommand", () => {
  it("records spawn errors as failed verifier artifacts", async () => {
    const { runGoalVerifierCommand } = await import("./goal-verifier.js");
    const resultPromise = runGoalVerifierCommand({
      cwd: tmpProject,
      runId: "goal-a",
      command: "missing-verifier",
      now: () => 1234,
    });
    await vi.waitFor(() => expect(child.listenerCount("error")).toBeGreaterThan(0));

    child.listeners("error").forEach((listener) => listener.call(child, new Error("spawn ENOENT")));
    child.emit("close", 1);
    const result = await resultPromise;

    expect(result.failureClass).toBe("verifier_spawn_error");
    expect(result.verification).toMatchObject({
      status: "fail",
      command: "missing-verifier",
      exitCode: 1,
      summary: "Verifier process error: spawn ENOENT",
    });
    expect(result.verification.outputPath).toBe(
      path.join(projectDir(tmpProject), "verifiers", "goal-a-1234.log"),
    );
    await expect(fs.readFile(result.verification.outputPath!, "utf-8")).resolves.toContain(
      "Verifier process error: spawn ENOENT",
    );
  });

  it("times out hung verifiers, kills them, and writes stable output artifacts", async () => {
    const { runGoalVerifierCommand } = await import("./goal-verifier.js");
    const resultPromise = runGoalVerifierCommand({
      cwd: tmpProject,
      runId: "goal-a",
      command: "sleep forever",
      timeoutMs: 25,
      now: () => 2000,
    });

    await vi.waitFor(() => expect(child.listenerCount("close")).toBeGreaterThan(0));
    await vi.waitFor(() => expect(child.stdout.listenerCount("data")).toBeGreaterThan(0));
    child.stdout
      .listeners("data")
      .forEach((listener) => listener.call(child.stdout, Buffer.from("partial output")));
    await vi.advanceTimersByTimeAsync(25);
    child.emit("close", 124);
    const result = await resultPromise;

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(result.failureClass).toBe("verifier_timeout");
    expect(result.verification).toMatchObject({ status: "fail", exitCode: 124 });
    expect(result.verification.summary).toContain("Verifier timed out after 25ms");
    expect(result.verification.outputPath).toBe(
      path.join(projectDir(tmpProject), "verifiers", "goal-a-2000.log"),
    );
    await expect(fs.readFile(result.verification.outputPath!, "utf-8")).resolves.toContain(
      "Verifier timed out after 25ms",
    );
  });
});
