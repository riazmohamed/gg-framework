import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectDir, type GoalVerificationResult } from "./goal-store.js";
import { killProcessTree } from "../utils/process.js";

export const DEFAULT_GOAL_VERIFIER_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_VERIFIER_OUTPUT_CHARS = 20_000;

export type GoalVerifierFailureClass =
  | "verifier_pass"
  | "verifier_failure"
  | "verifier_spawn_error"
  | "verifier_timeout";

export interface RunGoalVerifierOptions {
  cwd: string;
  runId: string;
  command: string;
  timeoutMs?: number;
  now?: () => number;
}

export interface RunGoalVerifierResult {
  verification: GoalVerificationResult;
  failureClass: GoalVerifierFailureClass;
  durationMs: number;
}

function appendOutput(output: string, chunk: Buffer): string {
  const next = output + chunk.toString("utf-8");
  return next.length > MAX_VERIFIER_OUTPUT_CHARS
    ? next.slice(next.length - MAX_VERIFIER_OUTPUT_CHARS)
    : next;
}

export async function runGoalVerifierCommand(
  options: RunGoalVerifierOptions,
): Promise<RunGoalVerifierResult> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_GOAL_VERIFIER_TIMEOUT_MS;
  const logDir = join(projectDir(options.cwd), "verifiers");
  await mkdir(logDir, { recursive: true });
  const outputPath = join(logDir, `${options.runId}-${startedAt}.log`);

  return await new Promise<RunGoalVerifierResult>((resolve) => {
    const child = spawn(options.command, {
      cwd: options.cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    let output = "";
    let settled = false;
    let timedOut = false;
    const finish = (code: number | null, forcedOutput?: string) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      const status = code === 0 ? "pass" : "fail";
      const failureClass: GoalVerifierFailureClass = timedOut
        ? "verifier_timeout"
        : forcedOutput?.startsWith("Verifier process error:")
          ? "verifier_spawn_error"
          : status === "fail"
            ? "verifier_failure"
            : "verifier_pass";
      const summary =
        (forcedOutput ?? output).trim() || (code === 0 ? "Verifier passed." : "Verifier failed.");
      void writeFile(outputPath, summary + "\n", "utf-8").finally(() => {
        resolve({
          verification: {
            status,
            summary,
            command: options.command,
            exitCode: code ?? 1,
            outputPath,
            checkedAt: new Date().toISOString(),
          },
          failureClass,
          durationMs: Math.max(0, now() - startedAt),
        });
      });
    };

    const timeout =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            if (child.pid) {
              killProcessTree(child.pid);
              child.kill("SIGTERM");
            }
            const killTimer = setTimeout(() => {
              if (!settled && child.pid) child.kill("SIGKILL");
            }, 5000);
            killTimer.unref?.();
            finish(124, `Verifier timed out after ${timeoutMs}ms and was terminated.\n${output}`);
          }, timeoutMs)
        : undefined;
    timeout?.unref?.();

    child.stdout?.on("data", (chunk: Buffer) => {
      output = appendOutput(output, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output = appendOutput(output, chunk);
    });
    child.on("close", (code) => finish(code));
    child.on("error", (err) => finish(1, `Verifier process error: ${err.message}`));
  });
}
