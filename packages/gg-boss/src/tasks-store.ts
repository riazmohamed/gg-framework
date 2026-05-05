import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { useSyncExternalStore } from "react";
import { getAppPaths } from "@abukhaled/ogcoder";

export type TaskStatus = "pending" | "in_progress" | "done" | "blocked" | "skipped";

export interface BossTask {
  id: string;
  /** Project name (matches a linked worker). */
  project: string;
  /** Short one-line summary shown in the overlay. */
  title: string;
  /** Full instruction sent to the worker when this task is dispatched. */
  description: string;
  status: TaskStatus;
  /** Pre-decided when adding — passed through to prompt_worker on dispatch. */
  fresh?: boolean;
  /** Boss's running notes / blocker reason. */
  notes?: string;
  /** When dispatched, holds the worker_turn_complete summary text. */
  resultSummary?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Lightweight task store — the boss orchestrator's plan-of-record. One JSON
 * file at ~/.gg/boss/plan.json, append-on-mutation, per-project grouping
 * happens in the read layer rather than on disk.
 */

function getPlanPath(): string {
  return path.join(getAppPaths().agentDir, "boss", "plan.json");
}

interface PlanFile {
  tasks: BossTask[];
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(path.dirname(getPlanPath()), { recursive: true, mode: 0o700 });
}

async function loadPlan(): Promise<BossTask[]> {
  try {
    const content = await fs.readFile(getPlanPath(), "utf-8");
    const parsed = JSON.parse(content) as Partial<PlanFile>;
    return Array.isArray(parsed.tasks) ? parsed.tasks : [];
  } catch {
    return [];
  }
}

async function persist(tasks: BossTask[]): Promise<void> {
  await ensureDir();
  await fs.writeFile(getPlanPath(), JSON.stringify({ tasks }, null, 2) + "\n", "utf-8");
}

// ── Reactive state ─────────────────────────────────────────

interface TasksUiState {
  tasks: BossTask[];
  /** Bumped on every mutation so overlay-side useEffects can react. */
  version: number;
}

let state: TasksUiState = { tasks: [], version: 0 };
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function getSnapshot(): TasksUiState {
  return state;
}

export function useTasksState(): TasksUiState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ── Helpers ────────────────────────────────────────────────

function newId(): string {
  return crypto.randomBytes(6).toString("hex");
}

function now(): string {
  return new Date().toISOString();
}

// ── Public API (used by tools, overlay, orchestrator) ──────

export const tasksStore = {
  /** Hydrate state from disk on startup. Idempotent. */
  async load(): Promise<void> {
    const tasks = await loadPlan();
    state = { tasks, version: state.version + 1 };
    notify();
  },

  /** Synchronous read. Used by boss tools that need to inspect/list. */
  list(filter?: { project?: string; status?: TaskStatus }): BossTask[] {
    let xs = state.tasks;
    if (filter?.project) xs = xs.filter((t) => t.project === filter.project);
    if (filter?.status) xs = xs.filter((t) => t.status === filter.status);
    return xs;
  },

  byId(id: string): BossTask | undefined {
    return state.tasks.find((t) => t.id === id);
  },

  async add(input: {
    project: string;
    title: string;
    description: string;
    fresh?: boolean;
  }): Promise<BossTask> {
    const task: BossTask = {
      id: newId(),
      project: input.project,
      title: input.title,
      description: input.description,
      status: "pending",
      fresh: input.fresh,
      createdAt: now(),
      updatedAt: now(),
    };
    state = { tasks: [...state.tasks, task], version: state.version + 1 };
    await persist(state.tasks);
    notify();
    return task;
  },

  async update(
    id: string,
    fields: Partial<Pick<BossTask, "status" | "notes" | "resultSummary" | "title" | "description">>,
  ): Promise<BossTask | null> {
    const idx = state.tasks.findIndex((t) => t.id === id);
    if (idx < 0) return null;
    const next = { ...state.tasks[idx]!, ...fields, updatedAt: now() };
    const tasks = state.tasks.slice();
    tasks[idx] = next;
    state = { tasks, version: state.version + 1 };
    await persist(state.tasks);
    notify();
    return next;
  },

  async remove(id: string): Promise<boolean> {
    const before = state.tasks.length;
    const tasks = state.tasks.filter((t) => t.id !== id);
    if (tasks.length === before) return false;
    state = { tasks, version: state.version + 1 };
    await persist(state.tasks);
    notify();
    return true;
  },

  /**
   * Find the next pending task for a project (FIFO by createdAt). Used by
   * dispatch_pending to pick what to send next.
   */
  nextPending(project: string): BossTask | undefined {
    return state.tasks
      .filter((t) => t.project === project && t.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  },

  /** Test/dev reset — wipes in-memory + disk. */
  async reset(): Promise<void> {
    state = { tasks: [], version: state.version + 1 };
    await persist([]);
    notify();
  },
};
