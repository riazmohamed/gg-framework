import { z } from "zod";
import type { AgentTool } from "@kenkaiiii/gg-agent";
import type { Worker } from "./worker.js";
import type { WorkerTurnSummary } from "./types.js";

export interface BossToolDeps {
  workers: Map<string, Worker>;
  /** Most recent turn summary per project. Populated by the orchestrator on each worker_turn_complete event. */
  lastSummaries: Map<string, WorkerTurnSummary>;
}

const listWorkersParams = z.object({});
const getWorkerStatusParams = z.object({
  project: z.string().describe("Project name as listed by list_workers."),
});
const promptWorkerParams = z.object({
  project: z.string().describe("Project name as listed by list_workers."),
  message: z
    .string()
    .describe(
      "The instruction to send to the worker. Be specific — the worker has full coding tools (read, write, edit, bash, grep, etc.).",
    ),
});
const getWorkerSummaryParams = z.object({
  project: z.string().describe("Project name as listed by list_workers."),
});

export function createBossTools(deps: BossToolDeps): AgentTool[] {
  const { workers, lastSummaries } = deps;

  const listWorkers: AgentTool<typeof listWorkersParams> = {
    name: "list_workers",
    description: "List all projects under your control with their cwd and current status.",
    parameters: listWorkersParams,
    execute() {
      if (workers.size === 0) return "(no workers registered)";
      const lines: string[] = [];
      for (const [name, w] of workers) {
        lines.push(`- ${name} (${w.cwd}) — status: ${w.getStatus()}`);
      }
      return lines.join("\n");
    },
  };

  const getWorkerStatus: AgentTool<typeof getWorkerStatusParams> = {
    name: "get_worker_status",
    description: "Get the current status (idle/working/error) of a single project.",
    parameters: getWorkerStatusParams,
    execute(args) {
      const w = workers.get(args.project);
      if (!w) return `Unknown project: ${args.project}`;
      return `${args.project}: ${w.getStatus()}`;
    },
  };

  const promptWorker: AgentTool<typeof promptWorkerParams> = {
    name: "prompt_worker",
    description:
      "Send a prompt to a worker. Fire-and-forget — returns immediately. You will be notified via a worker_turn_complete event when the worker finishes. Do NOT call this on a worker whose status is 'working'.",
    parameters: promptWorkerParams,
    async execute(args) {
      const w = workers.get(args.project);
      if (!w) return `Unknown project: ${args.project}`;
      if (w.getStatus() === "working") {
        return `Worker "${args.project}" is currently working — wait for its completion event before prompting again.`;
      }
      await w.prompt(args.message);
      return `Prompt sent to "${args.project}". Worker is now running.`;
    },
  };

  const getWorkerSummary: AgentTool<typeof getWorkerSummaryParams> = {
    name: "get_worker_summary",
    description:
      "Fetch the most recent turn summary from a worker — its final text and the list of tools it used. Use this to verify what a worker actually did.",
    parameters: getWorkerSummaryParams,
    execute(args) {
      const summary = lastSummaries.get(args.project);
      if (!summary) {
        return `No summary yet for "${args.project}" — it hasn't completed any turns.`;
      }
      const tools =
        summary.toolsUsed.length > 0
          ? summary.toolsUsed.map((t) => `${t.ok ? "✓" : "✗"}${t.name}`).join(", ")
          : "(no tools used)";
      return `Project: ${summary.project}
Turn: ${summary.turnIndex}
Status: ${summary.status}
Tools used: ${tools}
Timestamp: ${summary.timestamp}

Final text:
${summary.finalText || "(empty)"}`;
    },
  };

  return [listWorkers, getWorkerStatus, promptWorker, getWorkerSummary];
}
