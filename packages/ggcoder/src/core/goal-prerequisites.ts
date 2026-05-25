import { spawn } from "node:child_process";
import type { GoalPrerequisite, GoalPrerequisiteStatus, GoalRun } from "./goal-store.js";

export const DEFAULT_GOAL_PREREQUISITE_CHECK_TIMEOUT_MS = 15_000;
const MAX_PREREQUISITE_EVIDENCE_CHARS = 500;

export interface GoalPrerequisiteCheckResult {
  status: GoalPrerequisiteStatus;
  evidence: string;
}

export interface PrerequisiteCommandSafetyResult {
  safe: boolean;
  reason?: string;
}

export interface RunGoalPrerequisiteChecksResult {
  run: GoalRun;
  checkedCount: number;
}

function appendOutput(output: string, chunk: Buffer): string {
  const next = output + chunk.toString("utf-8");
  return next.length > MAX_PREREQUISITE_EVIDENCE_CHARS
    ? next.slice(next.length - MAX_PREREQUISITE_EVIDENCE_CHARS)
    : next;
}

function summarizePrerequisiteCheck(command: string, exitCode: number, output: string): string {
  const normalizedOutput = output.trim().replace(/\s+/g, " ");
  const suffix = normalizedOutput ? `; output: ${normalizedOutput}` : "";
  return `Checked locally: \`${command}\` exited ${exitCode}${suffix}`;
}

export function validateGoalPrerequisiteCheckCommand(
  command: string,
): PrerequisiteCommandSafetyResult {
  const normalized = command.trim();
  if (!normalized) return { safe: false, reason: "empty prerequisite check command" };
  const checks: Array<[RegExp, string]> = [
    [/\brm\s+(?:-[^\s]*r[^\s]*f|-f[^\s]*r|-rf|-fr)\b/i, "destructive rm -rf command"],
    [
      /\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|remove|uninstall|update|upgrade)\b/i,
      "package mutation command",
    ],
    [
      /\b(?:apt|apt-get|brew|pip|pip3|gem|cargo)\s+(?:install|add|remove|uninstall|update|upgrade)\b/i,
      "system/package mutation command",
    ],
    [/(^|[^<])>>?\s*[^\s&|;]/, "shell redirection that writes files"],
    [/\b(?:tee)\b(?!\s+-a?\s*\/dev\/null)/i, "tee file write command"],
    [/\b(?:touch|mkdir|mv|cp|chmod|chown|truncate)\b/i, "file mutation command"],
    [
      /\b(?:serve|vite|next\s+dev|npm\s+run\s+dev|pnpm\s+dev|yarn\s+dev)\b/i,
      "background/dev server command",
    ],
    [/[;&|]\s*$/, "trailing shell control operator"],
    [/&\s*(?:$|[#;])/, "background command"],
  ];
  for (const [pattern, reason] of checks) {
    if (pattern.test(normalized)) return { safe: false, reason };
  }
  return { safe: true };
}

export async function runGoalPrerequisiteCheckCommand({
  cwd,
  command,
  timeoutMs = DEFAULT_GOAL_PREREQUISITE_CHECK_TIMEOUT_MS,
}: {
  cwd: string;
  command: string;
  timeoutMs?: number;
}): Promise<GoalPrerequisiteCheckResult> {
  const safety = validateGoalPrerequisiteCheckCommand(command);
  if (!safety.safe) {
    return {
      status: "missing",
      evidence: `Prerequisite check rejected as unsafe: ${safety.reason}. Command was not executed: \`${command}\``,
    };
  }
  return await new Promise<GoalPrerequisiteCheckResult>((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    let output = "";
    let settled = false;
    const finish = (code: number | null, forcedOutput?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const exitCode = code ?? 1;
      resolve({
        status: exitCode === 0 ? "met" : "missing",
        evidence: summarizePrerequisiteCheck(command, exitCode, forcedOutput ?? output),
      });
    };
    const timeout = setTimeout(() => {
      if (child.pid) child.kill("SIGTERM");
      finish(124, `Prerequisite check timed out after ${timeoutMs}ms.`);
    }, timeoutMs);
    timeout.unref?.();
    child.stdout?.on("data", (chunk: Buffer) => {
      output = appendOutput(output, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output = appendOutput(output, chunk);
    });
    child.on("close", (code) => finish(code));
    child.on("error", (err) => finish(1, `Prerequisite check process error: ${err.message}`));
  });
}

export function shouldRunGoalPrerequisiteCheck(item: GoalPrerequisite): boolean {
  return !!item.checkCommand && (item.status !== "met" || !item.evidence?.trim());
}

export async function runGoalPrerequisiteChecks(
  cwd: string,
  run: GoalRun,
  timeoutMs?: number,
): Promise<RunGoalPrerequisiteChecksResult> {
  let checkedCount = 0;
  const prerequisites = await Promise.all(
    run.prerequisites.map(async (item): Promise<GoalPrerequisite> => {
      if (!shouldRunGoalPrerequisiteCheck(item) || !item.checkCommand) return item;
      checkedCount += 1;
      const result = await runGoalPrerequisiteCheckCommand({
        cwd,
        command: item.checkCommand,
        timeoutMs,
      });
      return {
        ...item,
        status: result.status,
        evidence: result.evidence,
        ...(result.status === "missing" && !item.instructions
          ? { instructions: `Make \`${item.checkCommand}\` pass locally.` }
          : {}),
      };
    }),
  );
  return { run: { ...run, prerequisites }, checkedCount };
}
