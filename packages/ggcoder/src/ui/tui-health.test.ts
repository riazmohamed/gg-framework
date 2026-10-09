import { describe, expect, it, vi } from "vitest";
import type { ProjectHealthScan } from "../core/project-health-scan.js";
import type { ChecklistSnapshot, ChecklistSnapshotRow } from "../core/checklist-snapshot.js";
import { checklistRunPrompt } from "../core/checklist-prompt.js";
import { CHECKLIST_ITEMS } from "../core/checklist-items.js";
import { createChecklistCommand, createHealthCommand } from "./tui-health.js";

const clean: ProjectHealthScan = {
  truncated: false,
  sourceFiles: 40,
  sourceLines: 10_000,
  oversized: [],
  oversizedCount: 0,
  hotspotCount: 0,
  oversizedWeightedExcess: 0,
  secretFiles: [],
  largeFiles: [],
  largeFileCount: 0,
  hasGitignore: true,
  missingLockfile: false,
  hasTests: true,
  hasLint: true,
  hasFormat: true,
  hasTypecheck: true,
  hasCIWorkflow: true,
  debt: { todos: 0, suppressions: 0, anyTypes: 0, lines: 10_000 },
};
const untested: ProjectHealthScan = { ...clean, hasTests: false, hasCIWorkflow: false };
const ctx = {} as never;

function health(scan: ProjectHealthScan | null) {
  const sendPrompt = vi.fn(async () => null);
  const command = createHealthCommand({
    cwd: () => "/repo",
    sendPrompt,
    scan: async () => scan,
    ci: async () => null,
  });
  return { command, sendPrompt };
}

describe("/health", () => {
  it("prints the score and every category", async () => {
    const { command } = health(untested);
    const text = await command.execute("", ctx);
    expect(text).toMatch(/^Project health: \d+%/);
    for (const label of ["File size", "Repo hygiene", "Safety net", "Debt markers"])
      expect(text).toContain(label);
    expect(text).toContain("/health review");
  });

  it("hands the findings to the agent on review, and declines when clean", async () => {
    const a = health(untested);
    expect(await a.command.execute("review", ctx)).toBe("");
    expect(a.sendPrompt).toHaveBeenCalledWith(
      "/health review",
      expect.stringContaining("# Project health review"),
    );
    const b = health(clean);
    expect(await b.command.execute("review", ctx)).toBe(
      "Project health is 100%, with nothing to fix.",
    );
    expect(b.sendPrompt).not.toHaveBeenCalled();
  });

  it("explains a non-Git folder and rejects unknown arguments", async () => {
    expect(await health(null).command.execute("", ctx)).toContain("needs a Git repository");
    expect(await health(clean).command.execute("fix", ctx)).toBe("Usage: /health [review]");
  });
});

function row(index: number, patch: Partial<ChecklistSnapshotRow> = {}): ChecklistSnapshotRow {
  const item = CHECKLIST_ITEMS[index];
  return {
    id: item.id,
    group: item.group,
    title: item.title,
    description: item.description,
    check: item.check,
    skill: null,
    setupCommand: null,
    status: "not-run",
    checkedAt: null,
    commit: null,
    uncommittedChanges: false,
    result: null,
    summary: null,
    findings: [],
    accepted: [],
    evidence: [],
    detection: null,
    runPrompt: checklistRunPrompt(item),
    changedSinceCheck: false,
    ...patch,
  } as ChecklistSnapshotRow;
}

function checklist(items: ChecklistSnapshotRow[]) {
  const snapshot: ChecklistSnapshot = { staleAfterDays: 30, detectionWarnings: [], items };
  const sendPrompt = vi.fn(async () => null);
  const command = createChecklistCommand({
    cwd: () => "/repo",
    sendPrompt,
    read: async () => ({ ok: true, value: snapshot }),
  });
  return { command, sendPrompt };
}

describe("/checklist", () => {
  const passed = row(0, {
    status: "passed",
    checkedAt: "2026-10-01T10:00:00Z",
    summary: "CLAUDE.md is current",
  });

  it("lists items by group with their status", async () => {
    const text = await checklist([passed, row(1)]).command.execute("", ctx);
    expect(text).toContain(`✓ ${CHECKLIST_ITEMS[0].id}`);
    expect(text).toContain("passed, 2026-10-01");
    expect(text).toContain("CLAUDE.md is current");
    expect(text).toContain(`· ${CHECKLIST_ITEMS[1].id}`);
    expect(text).toContain(CHECKLIST_ITEMS[0].group);
  });

  it("runs an item, or the next unchecked one, with the terminal's tool note", async () => {
    const { command, sendPrompt } = checklist([passed, row(1)]);
    await command.execute("next", ctx);
    const [display, prompt] = sendPrompt.mock.calls[0] as unknown as [string, string];
    expect(display).toBe(`/checklist run ${CHECKLIST_ITEMS[1].id}`);
    expect(prompt).toContain("The `checklist` tool is already loaded.");
    expect(prompt).not.toContain("tool_search");
    await command.execute(`run ${CHECKLIST_ITEMS[0].id}`, ctx);
    expect(sendPrompt).toHaveBeenCalledTimes(2);
  });

  it("reports unknown ids, a finished list and bad usage", async () => {
    expect(await checklist([passed]).command.execute("next", ctx)).toBe(
      "Every checklist item is up to date.",
    );
    expect(await checklist([passed]).command.execute("run nope", ctx)).toContain(
      "Unknown checklist item: nope",
    );
    expect(await checklist([passed]).command.execute("run", ctx)).toContain("Usage");
  });
});
