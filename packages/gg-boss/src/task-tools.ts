import { z } from "zod";
import type { AgentTool } from "@abukhaled/gg-agent";
import { tasksStore, type BossTask, type TaskStatus } from "./tasks-store.js";
import type { Worker } from "./worker.js";

export interface TaskToolDeps {
  workers: Map<string, Worker>;
  /**
   * Hook the orchestrator provides so dispatch_pending can fire-and-forget
   * a worker prompt and update task state on completion. Mirrors the
   * fire-and-forget contract of plain prompt_worker.
   */
  dispatchTaskByDescription: (
    project: string,
    description: string,
    fresh: boolean,
    taskId: string,
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
}

const addTaskParams = z.object({
  project: z.string().describe("Project name (must match a linked worker)."),
  title: z.string().describe("Short one-line summary shown in the task overlay."),
  description: z
    .string()
    .describe(
      "Full instruction sent to the worker when this task is dispatched. Should be specific and actionable.",
    ),
  fresh: z
    .boolean()
    .optional()
    .describe(
      "If true, the worker's session is wiped before this task runs. Use for unrelated direction changes.",
    ),
});

const listTasksParams = z.object({
  project: z.string().optional().describe("Filter to one project."),
  status: z
    .enum(["pending", "in_progress", "done", "blocked", "skipped"])
    .optional()
    .describe("Filter by status."),
});

const updateTaskParams = z.object({
  id: z.string().describe("Task id from list_tasks."),
  status: z
    .enum(["pending", "in_progress", "done", "blocked", "skipped"])
    .optional()
    .describe("New status."),
  notes: z.string().optional().describe("Boss commentary / blocker reason / outcome notes."),
});

const dispatchPendingParams = z.object({
  project: z
    .string()
    .optional()
    .describe(
      "Limit dispatch to one project. Omit to dispatch the next pending task for EVERY idle worker (parallel fan-out).",
    ),
});

function formatTask(t: BossTask): string {
  const head = `[${t.id}] ${t.project} · ${t.status} · ${t.title}`;
  return t.notes ? `${head} (${t.notes})` : head;
}

export function createTaskTools(deps: TaskToolDeps): AgentTool[] {
  const { workers, dispatchTaskByDescription } = deps;

  const addTask: AgentTool<typeof addTaskParams> = {
    name: "add_task",
    description:
      "Add a task to the boss's plan for a specific project. Tasks are persisted across sessions and visible in the Tasks overlay (Ctrl+T).",
    parameters: addTaskParams,
    async execute(args) {
      if (!workers.has(args.project)) return `Unknown project: ${args.project}`;
      const t = await tasksStore.add({
        project: args.project,
        title: args.title,
        description: args.description,
        fresh: args.fresh,
      });
      return `Added [${t.id}] ${t.project} · ${t.title}`;
    },
  };

  const listTasks: AgentTool<typeof listTasksParams> = {
    name: "list_tasks",
    description:
      "List tasks in the boss's plan, optionally filtered by project and/or status. Returns task ids so you can update or dispatch them.",
    parameters: listTasksParams,
    execute(args) {
      const xs = tasksStore.list({
        project: args.project,
        status: args.status as TaskStatus | undefined,
      });
      if (xs.length === 0) return "(no tasks)";
      return xs.map(formatTask).join("\n");
    },
  };

  const updateTask: AgentTool<typeof updateTaskParams> = {
    name: "update_task",
    description:
      "Update a task's status and/or notes. Use this after a worker_turn_complete to mark the task DONE / BLOCKED / SKIPPED. The notes field is for boss commentary or blocker reasons.",
    parameters: updateTaskParams,
    async execute(args) {
      const updated = await tasksStore.update(args.id, {
        status: args.status as TaskStatus | undefined,
        notes: args.notes,
      });
      if (!updated) return `Unknown task id: ${args.id}`;
      return `Updated ${formatTask(updated)}`;
    },
  };

  const dispatchPending: AgentTool<typeof dispatchPendingParams> = {
    name: "dispatch_pending",
    description:
      "Send the next pending task for one project (or for every idle worker if no project is given) via prompt_worker. Marks each dispatched task as in_progress. FIRE-AND-FORGET — listen for worker_turn_complete events as usual. Use this as the 'go' button after planning.",
    parameters: dispatchPendingParams,
    async execute(args) {
      const targetProjects = args.project
        ? [args.project]
        : [...workers.entries()].filter(([, w]) => w.getStatus() === "idle").map(([name]) => name);

      if (targetProjects.length === 0) {
        return "No idle workers to dispatch to.";
      }

      const dispatched: string[] = [];
      const skipped: string[] = [];

      for (const project of targetProjects) {
        const worker = workers.get(project);
        if (!worker) {
          skipped.push(`${project}: unknown project`);
          continue;
        }
        if (worker.getStatus() === "working") {
          skipped.push(`${project}: worker is busy`);
          continue;
        }
        const next = tasksStore.nextPending(project);
        if (!next) {
          skipped.push(`${project}: no pending tasks`);
          continue;
        }
        await tasksStore.update(next.id, { status: "in_progress" });
        const result = await dispatchTaskByDescription(
          project,
          next.description,
          next.fresh === true,
          next.id,
        );
        if (result.ok) {
          dispatched.push(`${project}: [${next.id}] ${next.title}`);
        } else {
          // Roll back to pending if dispatch failed.
          await tasksStore.update(next.id, { status: "pending" });
          skipped.push(`${project}: ${result.reason}`);
        }
      }

      const lines: string[] = [];
      if (dispatched.length > 0) {
        lines.push(`Dispatched ${dispatched.length}:`);
        for (const d of dispatched) lines.push(`  ✓ ${d}`);
      }
      if (skipped.length > 0) {
        lines.push(`Skipped ${skipped.length}:`);
        for (const s of skipped) lines.push(`  · ${s}`);
      }
      return lines.join("\n");
    },
  };

  return [addTask, listTasks, updateTask, dispatchPending];
}
