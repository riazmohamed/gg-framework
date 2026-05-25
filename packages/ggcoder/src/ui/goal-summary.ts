import {
  formatGoalBlockingPrerequisites,
  goalHasBlockingPrerequisites,
  type GoalRun,
  type GoalTask,
} from "../core/goal-store.js";

export interface GoalSummaryRow {
  label: string;
  value: string;
  detail?: string;
}

export interface GoalSummarySection {
  title: string;
  lines: string[];
}

function countGoalTasksByStatus(tasks: readonly GoalTask[], status: GoalTask["status"]): number {
  return tasks.filter((task) => task.status === status).length;
}

function firstText(values: readonly (string | undefined)[]): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0)?.trim();
}

function normalizeGoalSummaryText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateGoalSummary(value: string, maxLength = 90): string {
  const normalized = normalizeGoalSummaryText(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function goalSummarySentences(value: string): string[] {
  return (
    normalizeGoalSummaryText(value)
      .match(/[^.!?]+[.!?]?/g)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) ?? []
  );
}

function significantGoalSentence(value: string, pattern: RegExp): string | undefined {
  const sentences = goalSummarySentences(value);
  return sentences.find((sentence) => pattern.test(sentence)) ?? sentences[0];
}

function cleanGoalCompletionAuditSummary(summary: string): string {
  return normalizeGoalSummaryText(summary)
    .replace(/^FINAL_AUDIT_PASS\b\s*/i, "")
    .replace(/\bverifier_checked_at=\S+\s*/gi, "")
    .replace(/\boutput_path=\S+\s*/gi, "")
    .replace(/^[;:,.\s]+/, "")
    .trim();
}

function formatListWithOverflow(items: readonly string[], limit: number): string {
  const visible = items.slice(0, limit);
  const remaining = items.length - visible.length;
  return `${visible.join("; ")}${remaining > 0 ? `; +${remaining} more` : ""}`;
}

function truncateGoalLine(value: string, maxLength = 180): string {
  return truncateGoalSummary(value.replace(/^[-*]\s*/, ""), maxLength);
}

function goalTaskOutcomeLines(run: GoalRun): string[] {
  return run.tasks
    .filter((task) => task.status === "done")
    .map((task) => {
      const summary = task.lastSummary
        ? significantGoalSentence(
            task.lastSummary,
            /fixed|implemented|created|updated|verified|passed|recorded|changed|added/i,
          )
        : undefined;
      return summary
        ? `${task.title}: ${truncateGoalLine(summary, 200)}`
        : `${task.title}: completed.`;
    })
    .slice(0, 8);
}

function goalEvidenceOutcomeLines(run: GoalRun): string[] {
  return run.evidencePlan
    .filter((item) => item.status === "ready")
    .map((item) => {
      const proof = firstText([item.evidence, item.path, item.command]);
      return proof ? `${item.label}: ${truncateGoalLine(proof, 200)}` : `${item.label}: ready.`;
    })
    .slice(0, 8);
}

function goalManualReviewLines(run: GoalRun): string[] {
  const residual = goalResidualSummary(run);
  const blockerLines = run.blockers.map((blocker) => truncateGoalLine(blocker, 200));
  const residualLines = residual ? [residual] : [];
  return [...blockerLines, ...residualLines].slice(0, 4);
}

export function goalPassedDetail(run: GoalRun): string {
  const auditSummary =
    run.completionAudit?.status === "pass"
      ? cleanGoalCompletionAuditSummary(run.completionAudit.summary)
      : undefined;
  const auditOutcome = auditSummary
    ? significantGoalSentence(auditSummary, /criteria|evidence|verified|passed|satisfied|fixed/i)
    : undefined;
  if (auditOutcome) return truncateGoalSummary(auditOutcome, 180);

  const verifierPath = run.verifier?.lastResult?.outputPath;
  if (verifierPath)
    return `Final audit passed; verifier log: ${truncateGoalSummary(verifierPath, 110)}`;
  return "Verifier evidence and final audit passed; auto-continuation stopped.";
}

function goalFindingsSummary(run: GoalRun): string | undefined {
  const priorityEvidence = [...run.evidence]
    .reverse()
    .find((item) =>
      /close production gaps|source-backed.*gap|quality audit|findings|final completion audit/i.test(
        item.label,
      ),
    );
  const content = priorityEvidence?.content ?? run.completionAudit?.summary;
  const finding = content
    ? significantGoalSentence(content, /fix|finding|gap|residual|accepted|blocked|risk/i)
    : undefined;
  return finding ? truncateGoalSummary(finding, 120) : undefined;
}

function goalWorkSummary(run: GoalRun): string | undefined {
  const doneTaskTitles = run.tasks
    .filter((task) => task.status === "done")
    .map((task) => task.title.trim())
    .filter(Boolean);
  return doneTaskTitles.length > 0
    ? truncateGoalSummary(formatListWithOverflow(doneTaskTitles, 3), 120)
    : undefined;
}

function goalResidualSummary(run: GoalRun): string | undefined {
  const residualPlan = run.evidencePlan.find((item) => {
    const text = `${item.label} ${item.description} ${item.evidence ?? ""}`;
    return /residual|optional|canary|accepted risk|approval/i.test(text) && !!item.evidence?.trim();
  });
  const residualEvidence = [...run.evidence]
    .reverse()
    .find((item) =>
      /residual|optional.*canary|blocked pending approval|accepted risk/i.test(item.label),
    );
  const content = residualPlan?.evidence ?? residualEvidence?.content;
  const residual = content
    ? significantGoalSentence(content, /residual|optional|accepted|approval|not run|blocked/i)
    : undefined;
  return residual ? truncateGoalSummary(residual, 120) : undefined;
}

export function buildGoalFinalSummarySections(run: GoalRun): GoalSummarySection[] {
  if (run.status !== "passed") return [];

  const sections: GoalSummarySection[] = [];
  const outcome = goalPassedDetail(run);
  if (outcome) sections.push({ title: "Outcome", lines: [outcome] });

  const taskLines = goalTaskOutcomeLines(run);
  if (taskLines.length > 0) sections.push({ title: "What changed", lines: taskLines });

  const evidenceLines = goalEvidenceOutcomeLines(run);
  if (evidenceLines.length > 0) sections.push({ title: "Proof", lines: evidenceLines });

  const manualReviewLines = goalManualReviewLines(run);
  if (manualReviewLines.length > 0) {
    sections.push({ title: "Manual review / residual", lines: manualReviewLines });
  }

  return sections;
}

export function buildGoalSummaryRows(run: GoalRun): GoalSummaryRow[] {
  const rows: GoalSummaryRow[] = [];
  if (run.status === "passed") {
    const findings = goalFindingsSummary(run);
    if (findings) rows.push({ label: "Findings", value: findings });
    const work = goalWorkSummary(run);
    if (work) rows.push({ label: "Work", value: work });
    const residual = goalResidualSummary(run);
    if (residual) rows.push({ label: "Residual", value: residual });
  }

  const doneTasks = countGoalTasksByStatus(run.tasks, "done");
  const failedTasks = countGoalTasksByStatus(run.tasks, "failed");
  const blockedTasks = countGoalTasksByStatus(run.tasks, "blocked");
  const taskSuffix = [
    failedTasks > 0 ? `${failedTasks} failed` : undefined,
    blockedTasks > 0 ? `${blockedTasks} blocked` : undefined,
  ].filter((item): item is string => item !== undefined);
  rows.push({
    label: "Tasks",
    value: run.tasks.length > 0 ? `${doneTasks}/${run.tasks.length} done` : "none",
    ...(taskSuffix.length > 0 ? { detail: taskSuffix.join(", ") } : {}),
  });

  const verifierResult = run.verifier?.lastResult;
  const verifierDetail = firstText([verifierResult?.outputPath, run.verifier?.command]);
  rows.push({
    label: "Verifier",
    value: verifierResult?.status ?? (run.verifier?.command ? "ready" : "missing"),
    ...(verifierDetail ? { detail: truncateGoalSummary(verifierDetail) } : {}),
  });

  const latestEvidence = run.evidence.at(-1);
  rows.push({
    label: "Evidence",
    value: `${run.evidence.length} recorded`,
    ...(latestEvidence
      ? { detail: truncateGoalSummary(latestEvidence.path ?? latestEvidence.label) }
      : {}),
  });

  if (run.status === "blocked" || run.status === "paused" || run.blockers.length > 0) {
    rows.push({
      label: run.status === "paused" ? "Paused on" : "Blocked on",
      value: truncateGoalSummary(
        goalHasBlockingPrerequisites(run)
          ? formatGoalBlockingPrerequisites(run)
          : (run.blockers[0] ?? "manual review"),
        110,
      ),
    });
  } else if (run.successCriteria.length > 0) {
    rows.push({
      label: "Criteria",
      value: `${run.successCriteria.length} checked`,
      detail: truncateGoalSummary(run.successCriteria[0] ?? "", 80),
    });
  }

  return rows.slice(0, run.status === "passed" ? 8 : 4);
}
