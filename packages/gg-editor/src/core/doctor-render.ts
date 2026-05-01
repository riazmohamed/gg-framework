/**
 * Pretty-printer for DoctorReport.
 *
 * Two modes:
 *
 *   1. focused (default) — show ONE thing to fix at a time, highest
 *      priority first. After the user fixes it and re-runs, the next
 *      one surfaces. When everything's clear: "Nothing to fix."
 *      This is the daily-driver mode and what onboarding uses.
 *
 *   2. all — full inventory, grouped by severity. Useful when the user
 *      wants to see what's optional / unlocks what. Triggered by
 *      `ggeditor doctor --all`.
 *
 * Priority order for the focused mode:
 *     required-missing  >  optional-warn  >  optional-missing  >  done
 * Within a tier we keep the source order from runDoctor() so the most
 * impactful tools (ffmpeg, then auth) come first.
 */
import chalk from "chalk";
import type { DoctorCheck, DoctorReport } from "./doctor.js";

export interface RenderOptions {
  /** Show the welcome banner instead of the plain header. */
  onboarding?: boolean;
  /** Show every check, not just the next thing to fix. */
  all?: boolean;
}

export function renderDoctorReport(report: DoctorReport, opts: RenderOptions = {}): string {
  return opts.all ? renderAll(report, opts) : renderFocused(report, opts);
}

// ── Focused mode (default) ──────────────────────────────────

function renderFocused(report: DoctorReport, opts: RenderOptions): string {
  const out: string[] = [];

  const next = pickNextToFix(report);
  const done = countDone(report);
  const total = countActionable(report);

  if (!next) {
    // Nothing left to fix.
    out.push(
      "  " +
        chalk.green("✓ Nothing to fix. You're all good.") +
        chalk.dim(" Run `ggeditor` to start."),
    );
    out.push("  " + progressBar(done, total));
    out.push(chalk.dim("  Re-run with `ggeditor doctor --all` to see the full inventory."));
    out.push("");
    return out.join("\n");
  }

  // One focused item.
  out.push("  " + chalk.dim(progressBar(done, total)));
  out.push("");
  out.push("  " + severityHeading(next));
  out.push("  " + chalk.bold(next.label) + chalk.dim("  —  " + next.detail));
  out.push("");
  out.push("  " + chalk.dim("Why it matters"));
  out.push("    " + next.unlocks);
  if (next.fix) {
    out.push("");
    out.push("  " + chalk.dim("Fix"));
    for (const line of next.fix.split("\n")) {
      out.push("    " + chalk.cyan(line));
    }
  }
  out.push("");
  out.push(chalk.dim("  Re-run `ggeditor doctor` after fixing to see the next item."));
  if (!opts.all) {
    out.push(chalk.dim("  Or `ggeditor doctor --all` to see the full inventory."));
  }
  out.push("");
  return out.join("\n");
}

// ── All mode (--all) ────────────────────────────────────────

function renderAll(report: DoctorReport, _opts: RenderOptions): string {
  const out: string[] = [];

  const groups: Array<{ title: string; severities: DoctorCheck["severity"][] }> = [
    { title: "Required", severities: ["block", "required"] },
    { title: "Optional", severities: ["optional"] },
    { title: "Info", severities: ["info"] },
  ];

  for (const group of groups) {
    const items = report.checks.filter((c) => group.severities.includes(c.severity));
    if (items.length === 0) continue;
    out.push("  " + chalk.dim(group.title));
    for (const c of items) out.push(renderInventoryLine(c));
    out.push("");
  }

  // Summary
  const next = pickNextToFix(report);
  if (!next) {
    out.push(
      "  " +
        chalk.green("✓ Nothing to fix. You're all good.") +
        chalk.dim(" Run `ggeditor` to start."),
    );
  } else {
    out.push(
      "  " + chalk.dim("Next: ") + chalk.bold(next.label) + chalk.dim("  —  see `ggeditor doctor`"),
    );
  }
  out.push("");
  return out.join("\n");
}

function renderInventoryLine(c: DoctorCheck): string {
  const glyph =
    c.status === "ok"
      ? chalk.green("✓")
      : c.status === "warn"
        ? chalk.yellow("!")
        : c.severity === "required" || c.severity === "block"
          ? chalk.red("✗")
          : chalk.yellow("○");
  return `    ${glyph} ${c.label.padEnd(28)} ${chalk.dim(c.detail)}`;
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Pick the next thing to fix in priority order. `info` checks are
 * never returned (they're informational, not actionable).
 */
function pickNextToFix(report: DoctorReport): DoctorCheck | undefined {
  const tiers: Array<{ severity: DoctorCheck["severity"]; statuses: DoctorCheck["status"][] }> = [
    { severity: "block", statuses: ["missing", "warn"] },
    { severity: "required", statuses: ["missing", "warn"] },
    { severity: "optional", statuses: ["warn"] }, // warn before plain missing
    { severity: "optional", statuses: ["missing"] },
  ];
  for (const tier of tiers) {
    const hit = report.checks.find(
      (c) => c.severity === tier.severity && tier.statuses.includes(c.status),
    );
    if (hit) return hit;
  }
  return undefined;
}

/** Pretty heading above the focused item. */
function severityHeading(c: DoctorCheck): string {
  if (c.severity === "required" || c.severity === "block") {
    return chalk.red.bold("Next up — required");
  }
  if (c.status === "warn") return chalk.yellow.bold("Next up — needs attention");
  return chalk.yellow.bold("Next up — optional");
}

/** Count actionable items (everything except `info`). */
function countActionable(report: DoctorReport): number {
  return report.checks.filter((c) => c.severity !== "info").length;
}

function countDone(report: DoctorReport): number {
  return report.checks.filter((c) => c.severity !== "info" && c.status === "ok").length;
}

/** "[██████░░░] 6 of 9" — at-a-glance progress. */
function progressBar(done: number, total: number): string {
  const width = 12;
  const filled = total === 0 ? 0 : Math.round((done / total) * width);
  const bar = chalk.green("█".repeat(filled)) + chalk.dim("░".repeat(width - filled));
  return `${bar}  ${done} of ${total} ready`;
}
