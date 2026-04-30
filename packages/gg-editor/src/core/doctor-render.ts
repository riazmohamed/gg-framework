/**
 * Pretty-printer for DoctorReport. Lives next to the doctor logic so
 * the chalk dependency stays scoped to user-facing CLI output.
 */
import chalk from "chalk";
import type { DoctorCheck, DoctorReport } from "./doctor.js";

const SEVERITY_LABEL: Record<DoctorCheck["severity"], string> = {
  block: "BLOCK",
  required: "REQUIRED",
  optional: "OPTIONAL",
  info: "INFO",
};

function statusGlyph(c: DoctorCheck): string {
  if (c.status === "ok") return chalk.green("✓");
  if (c.status === "warn") return chalk.yellow("!");
  // missing — color by severity
  if (c.severity === "required" || c.severity === "block") return chalk.red("✗");
  if (c.severity === "optional") return chalk.yellow("○");
  return chalk.dim("·");
}

/** Render a single check as a 3-4 line block. */
function renderCheck(c: DoctorCheck): string {
  const lines: string[] = [];
  const badge = chalk.dim(`[${SEVERITY_LABEL[c.severity]}]`);
  const header = `${statusGlyph(c)} ${chalk.bold(c.label)}  ${badge}  ${chalk.dim(c.detail)}`;
  lines.push(header);
  lines.push(chalk.dim("    Unlocks: ") + c.unlocks);
  if (c.fix) {
    const fixed = c.fix
      .split("\n")
      .map((l) => "    " + chalk.cyan(l))
      .join("\n");
    lines.push(chalk.dim("    Fix:"));
    lines.push(fixed);
  }
  return lines.join("\n");
}

/**
 * Produce the full doctor output. Used by both the explicit
 * `ggeditor doctor` command and the first-run onboarding flow.
 */
export function renderDoctorReport(
  report: DoctorReport,
  opts: { onboarding?: boolean } = {},
): string {
  const out: string[] = [];
  if (opts.onboarding) {
    out.push("");
    out.push(chalk.bold("Welcome to gg-editor."));
    out.push(
      "Quick environment check before we go. This runs once; re-run any time with `ggeditor doctor`.",
    );
    out.push("");
  } else {
    out.push("");
    out.push(chalk.bold("gg-editor — environment doctor"));
    out.push("");
  }

  // Group: required > optional > info
  const groups: Array<{ title: string; severities: DoctorCheck["severity"][] }> = [
    { title: chalk.bold("Required"), severities: ["block", "required"] },
    { title: chalk.bold("Recommended (optional)"), severities: ["optional"] },
    { title: chalk.dim("Informational"), severities: ["info"] },
  ];

  for (const group of groups) {
    const items = report.checks.filter((c) => group.severities.includes(c.severity));
    if (items.length === 0) continue;
    out.push(group.title);
    out.push("");
    for (const c of items) out.push(renderCheck(c));
    out.push("");
  }

  // Summary line
  const missingRequired = report.checks.filter(
    (c) => c.severity === "required" && c.status !== "ok",
  );
  const missingOptional = report.checks.filter(
    (c) => c.severity === "optional" && c.status !== "ok",
  );

  if (report.ready) {
    out.push(chalk.green("✓ Ready to launch.") + chalk.dim(" Run `ggeditor` to start."));
  } else {
    out.push(
      chalk.yellow("! ") +
        chalk.bold(
          `${missingRequired.length} required item${missingRequired.length === 1 ? "" : "s"} missing.`,
        ) +
        " You can still launch ggeditor, but most tools will error until they're installed.",
    );
  }
  if (missingOptional.length > 0) {
    out.push(
      chalk.dim(
        `  ${missingOptional.length} optional item${missingOptional.length === 1 ? "" : "s"} would unlock more features (see above).`,
      ),
    );
  }
  out.push("");
  return out.join("\n");
}
