import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { GoalRun } from "./goal-store.js";
import {
  runGoalPrerequisiteCheckCommand,
  runGoalPrerequisiteChecks,
  shouldRunGoalPrerequisiteCheck,
} from "./goal-prerequisites.js";

function goalRun(overrides: Partial<GoalRun> = {}): GoalRun {
  return {
    id: "goal-a",
    title: "Goal",
    goal: "Check prerequisites before workers",
    status: "ready",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    projectPath: "/tmp/project",
    successCriteria: [],
    prerequisites: [],
    harness: [],
    evidencePlan: [],
    tasks: [],
    evidence: [],
    blockers: [],
    ...overrides,
  };
}

describe("goal prerequisite checks", () => {
  it("runs cheap local check commands and records non-secret evidence", async () => {
    const tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), "goal-prereq-test-project-"));
    try {
      await fs.writeFile(path.join(tmpProject, "fixture.txt"), "ready", "utf-8");

      const result = await runGoalPrerequisiteCheckCommand({
        cwd: tmpProject,
        command: "test -f fixture.txt",
      });

      expect(result.status).toBe("met");
      expect(result.evidence).toContain("`test -f fixture.txt` exited 0");
    } finally {
      await fs.rm(tmpProject, { recursive: true, force: true });
    }
  });

  it("only skips prerequisites that are met with recorded evidence", () => {
    expect(
      shouldRunGoalPrerequisiteCheck({
        id: "checked",
        label: "Checked",
        status: "met",
        evidence: "Already checked.",
        checkCommand: "true",
      }),
    ).toBe(false);
    expect(
      shouldRunGoalPrerequisiteCheck({
        id: "unchecked",
        label: "Unchecked",
        status: "met",
        checkCommand: "true",
      }),
    ).toBe(true);
    expect(
      shouldRunGoalPrerequisiteCheck({
        id: "unknown",
        label: "Unknown",
        status: "unknown",
        checkCommand: "true",
      }),
    ).toBe(true);
  });

  it("updates a Goal run with checked prerequisite statuses before workers start", async () => {
    const tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), "goal-prereq-test-project-"));
    try {
      const result = await runGoalPrerequisiteChecks(
        tmpProject,
        goalRun({
          prerequisites: [
            { id: "pass", label: "Passing check", status: "unknown", checkCommand: "true" },
            { id: "fail", label: "Failing check", status: "unknown", checkCommand: "false" },
          ],
        }),
      );

      expect(result.checkedCount).toBe(2);
      expect(result.run.prerequisites).toEqual([
        expect.objectContaining({
          id: "pass",
          status: "met",
          evidence: expect.stringContaining("exited 0"),
        }),
        expect.objectContaining({
          id: "fail",
          status: "missing",
          evidence: expect.stringContaining("exited 1"),
        }),
      ]);
    } finally {
      await fs.rm(tmpProject, { recursive: true, force: true });
    }
  });
});
