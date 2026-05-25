import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ProcessManager } from "../core/process-manager.js";
import type { GoalMode } from "../core/runtime-mode.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createGoalsTool } from "./goals.js";
import { createSubAgentTool } from "./subagent.js";
import { createWriteTool } from "./write.js";

function resultToString(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "content" in result) {
    const content = (result as { content: unknown }).content;
    if (typeof content === "string") return content;
  }
  return String(result);
}

const mockContext = {
  signal: new AbortController().signal,
  toolCallId: "goal-mode-test",
};

describe("goal mode tool restrictions", () => {
  let tmpDir: string;
  const goalModeRef: { current: GoalMode } = { current: "off" };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "goal-mode-test-"));
    goalModeRef.current = "off";
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  for (const mode of ["planner", "setup", "coordinator"] as const) {
    it(`blocks write in Goal ${mode} mode`, async () => {
      goalModeRef.current = mode;
      const tool = createWriteTool(tmpDir, undefined, undefined, goalModeRef);

      const result = resultToString(
        await tool.execute({ file_path: "created.txt", content: "goal mode" }, mockContext),
      );

      expect(result).toContain("restricted in Goal");
      expect(result).toContain("Goal metadata");
    });

    it(`blocks edit in Goal ${mode} mode`, async () => {
      goalModeRef.current = mode;
      const tool = createEditTool(tmpDir, new Map(), undefined, goalModeRef);

      const result = resultToString(
        await tool.execute(
          { file_path: "created.txt", edits: [{ old_text: "a", new_text: "b" }] },
          mockContext,
        ),
      );

      expect(result).toContain("restricted in Goal");
      expect(result).toContain("Goal metadata");
    });

    it(`blocks subagent in Goal ${mode} mode`, async () => {
      goalModeRef.current = mode;
      const tool = createSubAgentTool(tmpDir, [], "anthropic", "claude-sonnet-4-6", goalModeRef);

      const result = resultToString(await tool.execute({ task: "Do work" }, mockContext));

      expect(result).toContain("restricted in Goal");
      expect(result).toContain("Goal task creation");
    });
  }

  it("allows cheap foreground bash in Goal planner mode", async () => {
    goalModeRef.current = "planner";
    const processManager = new ProcessManager();
    const tool = createBashTool(tmpDir, processManager, undefined, goalModeRef);

    const result = resultToString(await tool.execute({ command: "echo planner-ok" }, mockContext));

    expect(result).toContain("Exit code: 0");
    expect(result).toContain("planner-ok");
    processManager.shutdownAll();
  });

  it("allows cheap foreground bash in Goal setup mode", async () => {
    goalModeRef.current = "setup";
    const processManager = new ProcessManager();
    const tool = createBashTool(tmpDir, processManager, undefined, goalModeRef);

    const result = resultToString(await tool.execute({ command: "echo setup-ok" }, mockContext));

    expect(result).toContain("Exit code: 0");
    expect(result).toContain("setup-ok");
    processManager.shutdownAll();
  });

  it("blocks background bash in Goal planner mode", async () => {
    goalModeRef.current = "planner";
    const processManager = new ProcessManager();
    const tool = createBashTool(tmpDir, processManager, undefined, goalModeRef);

    const result = resultToString(
      await tool.execute({ command: "sleep 10", run_in_background: true }, mockContext),
    );

    expect(result).toContain("background bash is restricted in Goal planner mode");
    processManager.shutdownAll();
  });

  it("blocks background bash in Goal setup mode", async () => {
    goalModeRef.current = "setup";
    const processManager = new ProcessManager();
    const tool = createBashTool(tmpDir, processManager, undefined, goalModeRef);

    const result = resultToString(
      await tool.execute({ command: "sleep 10", run_in_background: true }, mockContext),
    );

    expect(result).toContain("background bash is restricted in Goal setup mode");
    processManager.shutdownAll();
  });

  it("blocks all bash in Goal coordinator mode", async () => {
    goalModeRef.current = "coordinator";
    const processManager = new ProcessManager();
    const tool = createBashTool(tmpDir, processManager, undefined, goalModeRef);

    const result = resultToString(await tool.execute({ command: "echo nope" }, mockContext));

    expect(result).toContain("bash is restricted in Goal coordinator mode");
    processManager.shutdownAll();
  });

  it("blocks goals in Goal planner mode", async () => {
    goalModeRef.current = "planner";
    const tool = createGoalsTool(tmpDir, goalModeRef);

    const result = resultToString(await tool.execute({ action: "status" }, mockContext));

    expect(result).toContain("goals is restricted in Goal planner mode");
    expect(result).toContain("GOAL_PLAN");
  });

  it("keeps goals usable in Goal setup and coordinator modes", async () => {
    for (const mode of ["setup", "coordinator"] as const) {
      goalModeRef.current = mode;
      const tool = createGoalsTool(tmpDir, goalModeRef);

      const result = resultToString(
        await tool.execute(
          {
            action: "create",
            title: `Goal mode durable run ${mode}`,
            goal: `Prove the goals tool remains usable in ${mode} mode`,
            success_criteria: ["Goal run is created"],
          },
          mockContext,
        ),
      );

      expect(result).toContain("Goal created");
    }
  });
});
