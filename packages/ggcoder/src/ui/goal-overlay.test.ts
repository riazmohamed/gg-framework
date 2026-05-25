import { describe, expect, it } from "vitest";
import type { GoalRun } from "../core/goal-store.js";
import {
  clampGoalScrollOffset,
  clampGoalSelectedIndex,
  createGoalReviewSnapshot,
  formatGoalPlanMarkdown,
  formatGoalPrerequisiteSummary,
  formatGoalProgressText,
  formatGoalTaskSummary,
  formatGoalVerifierSummary,
  getGoalAutoExpandedState,
  getGoalCardExtraRowCount,
  getGoalExpandedDetailViewModel,
  getGoalCardStatusColor,
  getGoalCardTitleColor,
  getGoalListCardRowCount,
  getGoalListWindow,
  getGoalOverlayViewportRows,
  getGoalReadinessText,
  getGoalScrollOffsetForSelection,
  getGoalStatusCountsText,
  shouldPersistGoalOverlayRuns,
  sortGoalRunsForOverlay,
} from "./components/GoalOverlay.js";

function goalRun(overrides: Partial<GoalRun>): GoalRun {
  return {
    id: "goal-1",
    title: "Goal",
    goal: "Goal text",
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

describe("goal overlay helpers", () => {
  it("sorts runs newest first", () => {
    const oldRun = goalRun({ id: "old", updatedAt: "2024-01-01T00:00:00.000Z" });
    const newRun = goalRun({ id: "new", updatedAt: "2024-02-01T00:00:00.000Z" });

    expect(sortGoalRunsForOverlay([oldRun, newRun]).map((run) => run.id)).toEqual(["new", "old"]);
  });

  it("auto-expands the newest Goal exactly like plan review after setup", () => {
    const newest = goalRun({ id: "newest", updatedAt: "2024-02-01T00:00:00.000Z" });
    const older = goalRun({ id: "older", updatedAt: "2024-01-01T00:00:00.000Z" });

    expect(
      getGoalAutoExpandedState({
        autoExpandNewest: true,
        loaded: true,
        runs: [newest, older],
        alreadyExpanded: false,
      }),
    ).toEqual({ selectedIndex: 0, expandedRunId: "newest" });
    expect(
      getGoalAutoExpandedState({
        autoExpandNewest: true,
        loaded: true,
        runs: [newest],
        alreadyExpanded: true,
      }),
    ).toBeNull();
    expect(
      getGoalAutoExpandedState({
        autoExpandNewest: false,
        loaded: true,
        runs: [newest],
        alreadyExpanded: false,
      }),
    ).toBeNull();
  });

  it("clamps selected index", () => {
    expect(clampGoalSelectedIndex(3, 0)).toBe(0);
    expect(clampGoalSelectedIndex(-1, 3)).toBe(0);
    expect(clampGoalSelectedIndex(4, 3)).toBe(2);
    expect(clampGoalSelectedIndex(1, 3)).toBe(1);
  });

  it("clamps bounded Goal viewport scroll offsets", () => {
    expect(clampGoalScrollOffset(-2, 20, 5)).toBe(0);
    expect(clampGoalScrollOffset(99, 20, 5)).toBe(15);
    expect(clampGoalScrollOffset(4.8, 20, 5)).toBe(4);
    expect(clampGoalScrollOffset(Number.NaN, 20, 5)).toBe(0);
    expect(clampGoalScrollOffset(5, 3, 8)).toBe(0);
  });

  it("derives conservative internal viewport limits from terminal rows", () => {
    expect(getGoalOverlayViewportRows(30)).toBe(22);
    expect(getGoalOverlayViewportRows(8)).toBe(4);
    expect(getGoalOverlayViewportRows(Number.NaN)).toBe(8);
  });

  it("budgets complete cards by actual rows before showing another goal", () => {
    const runs = [
      goalRun({ id: "a" }),
      goalRun({ id: "b" }),
      goalRun({ id: "c" }),
      goalRun({ id: "d" }),
    ];

    expect(getGoalListWindow({ runs: [], selectedIndex: 0, viewportRows: 8 })).toMatchObject({
      rowsUsed: 1,
    });
    expect(getGoalListCardRowCount({ run: runs[0] })).toBe(4);
    expect(getGoalListWindow({ runs, selectedIndex: 0, viewportRows: 13 })).toEqual({
      start: 0,
      end: 2,
      hiddenBefore: 0,
      hiddenAfter: 2,
      rowsUsed: 10,
    });
    expect(getGoalListWindow({ runs, selectedIndex: 3, viewportRows: 13 })).toEqual({
      start: 2,
      end: 4,
      hiddenBefore: 2,
      hiddenAfter: 0,
      rowsUsed: 10,
    });
  });

  it("keeps expanded selection visible without growing terminal scrollback", () => {
    expect(
      getGoalScrollOffsetForSelection({
        selectedIndex: 12,
        currentOffset: 0,
        itemCount: 30,
        viewportRows: 5,
      }),
    ).toBe(8);
    expect(
      getGoalScrollOffsetForSelection({
        selectedIndex: 4,
        currentOffset: 8,
        itemCount: 30,
        viewportRows: 5,
      }),
    ).toBe(4);
    expect(
      getGoalScrollOffsetForSelection({
        selectedIndex: 10,
        currentOffset: 8,
        itemCount: 30,
        viewportRows: 5,
      }),
    ).toBe(8);
  });

  it("formats the full expanded Goal plan as markdown for dynamic detail rendering", () => {
    const run = goalRun({
      goal: "Long objective",
      successCriteria: ["criterion one", "criterion two"],
      prerequisites: [
        { id: "cli", label: "CLI", status: "met", evidence: "available" },
        { id: "token", label: "Token", status: "missing", instructions: "Provide token." },
      ],
      tasks: [
        {
          id: "task-a",
          title: "Task A",
          prompt: "Do A",
          status: "done",
          attempts: 1,
          lastSummary: "Implemented A.",
        },
        { id: "task-b", title: "Task B", prompt: "Do B", status: "pending", attempts: 0 },
      ],
      harness: [{ id: "harness", label: "Harness", command: "pnpm test" }],
      evidencePlan: [
        {
          id: "proof",
          label: "Proof path",
          mechanism: "test",
          description: "Run proof",
          status: "planned",
          command: "pnpm test",
        },
      ],
      verifier: { description: "Run tests", command: "pnpm test" },
      blockers: ["Needs user input"],
      evidence: [
        {
          id: "evidence",
          kind: "command",
          label: "Verifier result",
          content: "Verifier output",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ],
    });

    const markdown = formatGoalPlanMarkdown(run);

    expect(markdown).toContain("# Goal");
    expect(markdown).toContain("## Goal\n\nLong objective");
    expect(markdown).toContain("## Success criteria");
    expect(markdown).toContain("- criterion one");
    expect(markdown).toContain("## User prerequisites");
    expect(markdown).toContain("- **missing** Token");
    expect(markdown).toContain("User action required: Provide token.");
    expect(markdown).toContain("## Worker tasks");
    expect(markdown).toContain("Prompt: Do A");
    expect(markdown).toContain("## Harness");
    expect(markdown).toContain("Command: `pnpm test`");
    expect(markdown).toContain("## Evidence plan");
    expect(markdown).toContain("- **planned** Proof path (test)");
    expect(markdown).toContain("## Verifier");
    expect(markdown).toContain("## Evidence");
    expect(markdown).toContain("Content: Verifier output");
    expect(markdown).toContain("## Blockers");
  });

  it("recomputes expanded Goal detail content from the latest run snapshot", () => {
    const initial = goalRun({ title: "Mutable detail", tasks: [] });
    const updated = goalRun({
      ...initial,
      updatedAt: "2024-01-01T00:00:01.000Z",
      tasks: [{ id: "task-a", title: "Task A", prompt: "Do A", status: "done", attempts: 1 }],
    });

    const before = getGoalExpandedDetailViewModel({ run: initial, markdownWidth: 80 });
    const after = getGoalExpandedDetailViewModel({ run: updated, markdownWidth: 80 });

    expect(before.content).toContain("No worker tasks yet");
    expect(after.content).toContain("Task A");
    expect(after.content).not.toEqual(before.content);
  });

  it("creates immutable review snapshots for scrollback-friendly Goal plan review", () => {
    const run = goalRun({
      id: "review-goal",
      updatedAt: "2024-01-01T00:00:00.000Z",
      title: "Review me",
      successCriteria: ["User can read the whole plan with terminal scrollback"],
    });
    const snapshot = createGoalReviewSnapshot({ run, markdownWidth: 100.8 });
    const updated = goalRun({
      ...run,
      updatedAt: "2024-01-01T00:00:01.000Z",
      successCriteria: ["Different content after polling"],
    });

    expect(snapshot.id).toBe("review-goal:2024-01-01T00:00:00.000Z:100");
    expect(snapshot.markdownWidth).toBe(100);
    expect(snapshot.content).toContain("User can read the whole plan with terminal scrollback");
    expect(snapshot.content).not.toContain("Different content after polling");
    expect(createGoalReviewSnapshot({ run: updated, markdownWidth: 100 }).id).not.toBe(snapshot.id);
  });

  it("updates expanded Goal detail width without relying on append-only Static state", () => {
    const run = goalRun({ title: "Responsive detail" });

    expect(getGoalExpandedDetailViewModel({ run, markdownWidth: 80 }).markdownWidth).toBe(80);
    expect(getGoalExpandedDetailViewModel({ run, markdownWidth: 120 }).markdownWidth).toBe(120);
  });

  it("includes the human final summary in passed Goal markdown", () => {
    const run = goalRun({
      status: "passed",
      tasks: [
        {
          id: "task-a",
          title: "Task A",
          prompt: "Do A",
          status: "done",
          attempts: 1,
          lastSummary: "Implemented A and verified it.",
        },
      ],
      verifier: {
        description: "Run tests",
        command: "pnpm test",
        lastResult: {
          status: "pass",
          summary: "passed",
          checkedAt: "2024-01-01T00:00:00.000Z",
          outputPath: "artifacts/goal-pass.log",
        },
      },
      completionAudit: {
        status: "pass",
        summary: "FINAL_AUDIT_PASS original-goal-prompt GOAL_PLAN All findings fixed.",
        checkedAt: "2024-01-01T00:00:01.000Z",
        verifierCheckedAt: "2024-01-01T00:00:00.000Z",
      },
    });

    const markdown = formatGoalPlanMarkdown(run);

    expect(markdown).toContain("## Final summary");
    expect(markdown).toContain("### Outcome");
    expect(markdown).toContain("All findings fixed.");
    expect(markdown).toContain("## Final audit");
    expect(markdown).toContain("Verifier checked at: 2024-01-01T00:00:00.000Z");
  });

  it("counts extra rows for list cards only", () => {
    expect(getGoalCardExtraRowCount(goalRun({}))).toBe(0);
    expect(
      getGoalCardExtraRowCount(
        goalRun({ prerequisites: [{ id: "token", label: "Token", status: "missing" }] }),
      ),
    ).toBe(1);
    expect(getGoalCardExtraRowCount(goalRun({ blockers: ["Blocked"] }))).toBe(1);
  });

  it("summarizes prerequisites including blocking states", () => {
    const run = goalRun({
      prerequisites: [
        { id: "cli", label: "CLI", status: "met" },
        { id: "sim", label: "Simulator", status: "missing" },
        { id: "data", label: "Fixture data", status: "unknown" },
      ],
    });

    expect(formatGoalPrerequisiteSummary(run)).toBe("1/3 prereqs met (1 missing, 1 unknown)");
  });

  it("summarizes task states", () => {
    const run = goalRun({
      tasks: [
        { id: "a", title: "A", prompt: "A", status: "done", attempts: 1 },
        { id: "b", title: "B", prompt: "B", status: "running", attempts: 2 },
        { id: "c", title: "C", prompt: "C", status: "failed", attempts: 1 },
        { id: "d", title: "D", prompt: "D", status: "blocked", attempts: 0 },
      ],
    });

    expect(formatGoalTaskSummary(run)).toBe("1/4 tasks done (1 running, 1 failed, 1 blocked)");
  });

  it("formats concise progress and readiness affordances", () => {
    expect(formatGoalProgressText(goalRun({}))).toBe("no prereqs · no tasks");
    expect(
      formatGoalProgressText(
        goalRun({
          prerequisites: [
            { id: "a", label: "A", status: "met", evidence: "checked" },
            { id: "b", label: "B", status: "missing" },
          ],
          tasks: [
            { id: "t1", title: "T1", prompt: "Do it", status: "done", attempts: 1 },
            { id: "t2", title: "T2", prompt: "Do more", status: "pending", attempts: 0 },
          ],
        }),
      ),
    ).toBe("prereqs 1/2 · tasks 1/2");

    expect(
      getGoalReadinessText(
        goalRun({ prerequisites: [{ id: "token", label: "Token", status: "missing" }] }),
      ),
    ).toBe("needs user input");
    expect(getGoalReadinessText(goalRun({ status: "running" }))).toBe("work in progress");
    expect(getGoalReadinessText(goalRun({ status: "verifying" }))).toBe("work in progress");
    expect(getGoalReadinessText(goalRun({ status: "passed" }))).toBe("verified");
    expect(
      getGoalReadinessText(
        goalRun({
          status: "ready",
          tasks: [{ id: "t", title: "T", prompt: "Do it", status: "pending", attempts: 0 }],
        }),
      ),
    ).toBe("ready to run");
    expect(getGoalReadinessText(goalRun({ status: "draft" }))).toBe("drafting plan");
    expect(
      getGoalReadinessText(
        goalRun({ verifier: { description: "Run tests", command: "pnpm test" } }),
      ),
    ).toBe("ready to verify");
  });

  it("summarizes verifier state", () => {
    expect(formatGoalVerifierSummary(goalRun({}))).toBe("no verifier");
    expect(
      formatGoalVerifierSummary(
        goalRun({ verifier: { description: "Run tests", command: "pnpm test" } }),
      ),
    ).toBe("verifier command ready");
    expect(
      formatGoalVerifierSummary(
        goalRun({
          verifier: {
            description: "Run tests",
            lastResult: {
              status: "pass",
              summary: "passed",
              checkedAt: "2024-01-01T00:00:00.000Z",
            },
          },
        }),
      ),
    ).toBe("verifier pass");
  });

  it("formats status counts for header", () => {
    const runs = [
      goalRun({ id: "passed", status: "passed" }),
      goalRun({ id: "running", status: "running" }),
      goalRun({ id: "paused", status: "paused" }),
      goalRun({ id: "blocked", status: "blocked" }),
    ];

    expect(getGoalStatusCountsText(runs)).toBe("1 passed · 1 running · 1 pending · 1 blocked");
  });

  it("keeps unselected goal cards readable when multiple goals are listed", () => {
    expect(
      getGoalCardStatusColor({
        status: "ready",
        selected: false,
        primaryColor: "primary",
        textColor: "text",
      }),
    ).toBe("text");
    expect(
      getGoalCardStatusColor({
        status: "running",
        selected: false,
        primaryColor: "primary",
        textColor: "text",
      }),
    ).toBe("#fbbf24");
    expect(
      getGoalCardStatusColor({
        status: "blocked",
        selected: false,
        primaryColor: "primary",
        textColor: "text",
      }),
    ).toBe("#fbbf24");
    expect(
      getGoalCardStatusColor({
        status: "paused",
        selected: false,
        primaryColor: "primary",
        textColor: "text",
      }),
    ).toBe("text");
    expect(
      getGoalCardStatusColor({
        status: "failed",
        selected: false,
        primaryColor: "primary",
        textColor: "text",
      }),
    ).toBe("red");
    expect(
      getGoalCardStatusColor({
        status: "passed",
        selected: false,
        primaryColor: "primary",
        textColor: "text",
      }),
    ).toBe("#4ade80");
    expect(
      getGoalCardTitleColor({ selected: false, primaryColor: "primary", textColor: "text" }),
    ).toBe("text");
    expect(
      getGoalCardTitleColor({ selected: true, primaryColor: "primary", textColor: "text" }),
    ).toBe("primary");
  });

  it("refuses to persist a transient empty overlay state while active Goal work exists", () => {
    const activeRuns = [
      goalRun({
        id: "active",
        status: "running",
        activeWorkerId: "worker-a",
        tasks: [
          {
            id: "task-a",
            title: "Active work",
            prompt: "Do work",
            status: "running",
            attempts: 1,
            workerId: "worker-a",
          },
        ],
      }),
    ];

    expect(shouldPersistGoalOverlayRuns(activeRuns, [])).toBe(false);
    expect(shouldPersistGoalOverlayRuns(activeRuns, [goalRun({ id: "next" })])).toBe(true);
    expect(shouldPersistGoalOverlayRuns([goalRun({ id: "done", status: "passed" })], [])).toBe(
      true,
    );
  });
});
