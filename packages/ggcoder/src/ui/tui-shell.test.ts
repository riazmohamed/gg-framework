import { describe, expect, it, vi } from "vitest";
import os from "node:os";
import type { ShellRunEnd } from "../app-sidecar/shell-runs.js";
import { USER_SHELL_CONTEXT_PREFIX } from "../core/user-shell-context.js";
import { createTuiShell, formatShellResult, parseBangCommand } from "./tui-shell.js";

const posix = process.platform !== "win32";

function end(over: Partial<ShellRunEnd> = {}): ShellRunEnd {
  return {
    runId: "r1",
    command: "git status",
    cwd: "/repo",
    exitCode: 0,
    signal: null,
    durationMs: 1234,
    cancelled: false,
    tail: "On branch main",
    displayTail: "On branch main",
    tailTruncated: false,
    displayTruncated: false,
    ...over,
  };
}

describe("parseBangCommand", () => {
  it("reads the command after the bang", () => {
    expect(parseBangCommand("!git status")).toBe("git status");
    expect(parseBangCommand("  ! ls -la ")).toBe("ls -la");
  });
  it("returns an empty command for a lone bang and null for ordinary input", () => {
    expect(parseBangCommand("!")).toBe("");
    expect(parseBangCommand("fix the tests!")).toBeNull();
    expect(parseBangCommand("/help")).toBeNull();
  });
});

describe("formatShellResult", () => {
  it("shows the command, exit status, time and output", () => {
    expect(formatShellResult(end())).toBe("$ git status  (exit 0, 1.2s)\nOn branch main");
  });
  it("names a stop, a start failure and an empty or cut output", () => {
    expect(formatShellResult(end({ cancelled: true, durationMs: 40 }))).toContain(
      "(stopped, 40ms)",
    );
    expect(formatShellResult(end({ error: "ENOENT", exitCode: null }))).toContain(
      "failed to start: ENOENT",
    );
    expect(formatShellResult(end({ tail: "" }))).toContain("(no output)");
    expect(formatShellResult(end({ tailTruncated: true }))).toContain("earlier output not shown");
  });
});

describe.runIf(posix)("createTuiShell", () => {
  it("runs a command, reports it, and hands its output to the next message once", async () => {
    const record = vi.fn(async () => {});
    let shell!: ReturnType<typeof createTuiShell>;
    const done = new Promise<{ run: ShellRunEnd; text: string }>((resolve) => {
      shell = createTuiShell({
        cwd: () => os.tmpdir(),
        record,
        onEnd: (run, text) => resolve({ run, text }),
      });
    });
    expect(shell.run("echo hello-from-bang")).toEqual({ ok: true });
    expect(shell.isRunning()).toBe(true);
    expect(shell.run("echo again")).toMatchObject({ ok: false });
    const { run, text } = await done;
    expect(run.exitCode).toBe(0);
    expect(text).toContain("hello-from-bang");
    expect(shell.isRunning()).toBe(false);
    expect(record).toHaveBeenCalledWith(os.tmpdir(), "echo hello-from-bang");
    const note = shell.takeContext();
    expect(note?.role).toBe("user");
    expect(note?.content).toContain(USER_SHELL_CONTEXT_PREFIX);
    expect(note?.content).toContain("$ echo hello-from-bang");
    expect(note?.provenance).toMatchObject({ visibility: "hidden" });
    expect(shell.takeContext()).toBeNull();
  });

  it("refuses a blank command and stops a running one", async () => {
    let shell!: ReturnType<typeof createTuiShell>;
    const done = new Promise<ShellRunEnd>((resolve) => {
      shell = createTuiShell({
        cwd: () => os.tmpdir(),
        record: async () => {},
        onEnd: (run) => resolve(run),
      });
    });
    expect(shell.run("")).toMatchObject({ ok: false });
    expect(shell.stop()).toBe(false);
    expect(shell.run("sleep 30")).toEqual({ ok: true });
    expect(shell.stop()).toBe(true);
    const run = await done;
    expect(run.cancelled).toBe(true);
  });
});
