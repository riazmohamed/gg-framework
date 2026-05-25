import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export interface Task {
  id: string;
  title: string;
  prompt: string;
  /** @deprecated Old field — migrated to title+prompt on load */
  text?: string;
  details?: string;
  status: "pending" | "in-progress" | "done";
  createdAt: string;
}

const TASKS_BASE = join(homedir(), ".gg-tasks", "projects");

function hashPath(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 16);
}

export function projectTaskDir(cwd: string): string {
  return join(TASKS_BASE, hashPath(cwd));
}

export async function loadTasks(cwd: string): Promise<Task[]> {
  try {
    const data = await readFile(join(projectTaskDir(cwd), "tasks.json"), "utf-8");
    const raw = JSON.parse(data) as Task[];
    return raw.map((t) => {
      if (!t.prompt && t.text) {
        return { ...t, title: t.text, prompt: t.text, text: undefined };
      }
      return t;
    });
  } catch {
    return [];
  }
}

export async function saveTasks(cwd: string, tasks: Task[]): Promise<void> {
  const dir = projectTaskDir(cwd);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "tasks.json"), JSON.stringify(tasks, null, 2) + "\n", "utf-8");
  const meta = JSON.stringify({ path: cwd, name: basename(cwd) }, null, 2) + "\n";
  await writeFile(join(dir, "meta.json"), meta, "utf-8");
}

export async function getNextPendingTask(cwd: string): Promise<Task | null> {
  const tasks = await loadTasks(cwd);
  return tasks.find((t) => t.status === "pending") ?? null;
}

export async function setTaskStatus(
  cwd: string,
  id: string,
  status: Task["status"],
): Promise<void> {
  const tasks = await loadTasks(cwd);
  const next = tasks.map((t) => (t.id === id ? { ...t, status } : t));
  await saveTasks(cwd, next);
}
