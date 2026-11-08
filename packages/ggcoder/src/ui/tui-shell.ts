import type { Message } from "@abukhaled/gg-ai";
import {
  ShellRunner,
  formatShellContext,
  type ShellRunEnd,
  type ShellRunnerOptions,
} from "../app-sidecar/shell-runs.js";
import { recordShellCommand } from "../app-sidecar/shell-suggestions.js";
import { buildUserShellContextText } from "../core/user-shell-context.js";

/**
 * `!cmd` in the terminal: the TUI twin of the desktop app's terminal commands.
 *
 * The command runs with the user's own shell, environment and permissions in
 * the project folder (the sidecar's `ShellRunner`, not the agent's guarded bash
 * tool), because the user typed it. Its output is shown, and held as a hidden
 * note that reaches the agent with the next message, never on its own
 * (`core/user-shell-context.ts`, the same framing the desktop uses).
 */

/** `!git status` → `git status`; `!` alone → "" (usage); anything else → null. */
export function parseBangCommand(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("!")) return null;
  return trimmed.slice(1).trim();
}

function seconds(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** The transcript row for a finished command. */
export function formatShellResult(run: ShellRunEnd): string {
  const status = run.error
    ? `failed to start: ${run.error}`
    : run.cancelled
      ? "stopped"
      : `exit ${run.exitCode ?? run.signal ?? "?"}`;
  const head = `$ ${run.command}  (${status}, ${seconds(run.durationMs)})`;
  const body = run.tail ? run.tail : "(no output)";
  const cut = run.tailTruncated ? "\n… earlier output not shown" : "";
  return `${head}${cut}\n${body}`;
}

export interface TuiShellOptions {
  cwd: () => string;
  /** A command finished: show it. */
  onEnd: (run: ShellRunEnd, text: string) => void;
  spawn?: ShellRunnerOptions["spawn"];
  env?: NodeJS.ProcessEnv;
  record?: (cwd: string, command: string) => Promise<void>;
}

export interface TuiShell {
  /** Start a command. An error string when it can't start (one runs at a time). */
  run(command: string): { ok: true } | { ok: false; error: string };
  /** Stop the running command. False when nothing is running. */
  stop(): boolean;
  isRunning(): boolean;
  /** Finished commands' output as one hidden note for the next message, or null. */
  takeContext(): Message | null;
  stopAll(): void;
}

export function createTuiShell(opts: TuiShellOptions): TuiShell {
  let current: string | null = null;
  let seq = 0;
  const pending: string[] = [];
  const runner = new ShellRunner({
    // Output arrives whole at the end; the terminal shows the result once.
    emit: () => {},
    onEnd: (run) => {
      if (current === run.runId) current = null;
      const context = formatShellContext(run);
      if (context.trim()) pending.push(context);
      opts.onEnd(run, formatShellResult(run));
    },
    ...(opts.spawn ? { spawn: opts.spawn } : {}),
    ...(opts.env ? { env: opts.env } : {}),
  });
  return {
    run(command) {
      if (!command) return { ok: false, error: "Usage: !<command>, e.g. !git status" };
      if (current) return { ok: false, error: "A command is still running. Esc stops it." };
      const runId = `tui-shell-${++seq}`;
      const cwd = opts.cwd();
      const started = runner.start(runId, command, cwd);
      if (!started.ok) return started;
      current = runId;
      void (opts.record ?? recordShellCommand)(cwd, command).catch(() => {});
      return { ok: true };
    },
    stop() {
      return current ? runner.cancel(current) : false;
    },
    isRunning() {
      return current !== null;
    },
    takeContext() {
      if (pending.length === 0) return null;
      return {
        role: "user",
        content: buildUserShellContextText(pending.splice(0)),
        provenance: { source: "runtime", kind: "notification", visibility: "hidden" },
      };
    },
    stopAll() {
      runner.stopAll();
    },
  };
}
