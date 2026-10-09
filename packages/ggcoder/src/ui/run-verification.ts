import type { ContentPart, Message } from "@abukhaled/gg-ai";
import { describeTurnVerification } from "../core/run-status.js";
import { collectVerificationEvidence } from "../core/verification-evidence.js";

/** Tools whose successful call changes project files. */
const MUTATING_TOOLS = new Set(["write", "edit", "ui_adopt"]);

export interface RunVerificationLine {
  text: string;
  tone: "passed" | "failed" | "warning";
}

/**
 * The desktop activity line's verdict for one run, from host-observed evidence
 * only (never from what the assistant says): which bounded checks ran after
 * the run's last file edit, and how they exited. Null for runs that neither
 * edited files nor ran a check, so a plain question gets no status line.
 */
export function summarizeRunVerification(
  runMessages: readonly Message[],
): RunVerificationLine | null {
  let lastMutation = -1;
  runMessages.forEach((message, index) => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) return;
    const parts = message.content as ContentPart[];
    if (parts.some((part) => part.type === "tool_call" && MUTATING_TOOLS.has(part.name))) {
      lastMutation = index;
    }
  });
  const changed = lastMutation !== -1;
  // A check only covers edits made before it started.
  const evidence = collectVerificationEvidence(
    changed ? runMessages.slice(lastMutation) : runMessages,
  );
  const counted = evidence.filter((entry) => entry.status !== "rejected");
  if (!changed && counted.length === 0) return null;

  const passedAfterEdit = counted.some((entry) => entry.status === "passed");
  const status = describeTurnVerification(
    { changed, evidence: counted },
    changed && !passedAfterEdit ? "No check ran after the last edit" : null,
  );
  const plural = (n: number) => `${n} check${n === 1 ? "" : "s"}`;
  if (status.verification === "failed") {
    const failed = counted.filter((entry) => entry.status === "failed");
    const first = failed[0]?.command ?? "";
    const shown = first.length > 60 ? `${first.slice(0, 59)}…` : first;
    return {
      text: `✗ ${plural(failed.length)} failed${shown ? `: ${shown}` : ""}`,
      tone: "failed",
    };
  }
  if (status.verification === "passed") {
    return {
      text: `✓ ${plural(status.verifiedChecks)} passed${changed ? " after the last edit" : ""}`,
      tone: "passed",
    };
  }
  return { text: "! Files changed, but no check ran after the last edit", tone: "warning" };
}
