import { describe, expect, it } from "vitest";
import type { DoctorCheck, DoctorReport } from "./doctor.js";
import { renderDoctorReport } from "./doctor-render.js";

/**
 * Strip ANSI escape sequences so assertions don't depend on chalk's
 * runtime behavior (it auto-disables colors when stdout isn't a TTY).
 * The pattern matches CSI sequences like \x1b[31m, \x1b[0m, etc.
 */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const strip = (s: string) => s.replace(ANSI_RE, "");

function check(
  id: string,
  severity: DoctorCheck["severity"],
  status: DoctorCheck["status"],
  fix?: string,
): DoctorCheck {
  return {
    id,
    label: id,
    severity,
    status,
    detail: status === "ok" ? "found" : "missing",
    unlocks: `What ${id} unlocks.`,
    fix,
  };
}

function report(checks: DoctorCheck[]): DoctorReport {
  return {
    checks,
    ready: checks.every((c) => c.severity !== "required" || c.status === "ok"),
    markerPath: "/tmp/.gg/onboarded-ggeditor",
    onboarded: false,
  };
}

describe("renderDoctorReport — focused mode (default)", () => {
  it("shows 'Nothing to fix' when every actionable check passes", () => {
    const r = report([
      check("ffmpeg", "required", "ok"),
      check("auth", "required", "ok"),
      check("openai", "optional", "ok"),
      check("info-only", "info", "missing"), // info doesn't count
    ]);
    const out = strip(renderDoctorReport(r));
    expect(out).toContain("Nothing to fix");
    expect(out).toContain("ggeditor");
    // Should NOT show any individual check details when everything's ok.
    expect(out).not.toContain("Why it matters");
    expect(out).not.toContain("Fix");
  });

  it("surfaces a missing required item before any optional one", () => {
    const r = report([
      check("openai", "optional", "missing", "set OPENAI_API_KEY"),
      check("ffmpeg", "required", "missing", "brew install ffmpeg"),
    ]);
    const out = strip(renderDoctorReport(r));
    // Required headings should mention 'required'.
    expect(out).toContain("required");
    // The missing required item should be the focal point — its
    // label appears as the heading-bold thing.
    expect(out).toContain("ffmpeg");
    expect(out).toContain("brew install ffmpeg");
    // The optional item should NOT be rendered as the focal point.
    expect(out).not.toContain("set OPENAI_API_KEY");
  });

  it("falls back to optional items only when no required is missing", () => {
    const r = report([
      check("ffmpeg", "required", "ok"),
      check("ffprobe", "required", "ok"),
      check("openai", "optional", "missing", "set OPENAI_API_KEY"),
    ]);
    const out = strip(renderDoctorReport(r));
    expect(out).toContain("optional");
    expect(out).toContain("openai");
    expect(out).toContain("set OPENAI_API_KEY");
  });

  it("never picks an info-severity item as the focal point", () => {
    const r = report([
      check("ffmpeg", "required", "ok"),
      check("auth", "required", "ok"),
      check("anthropic-key", "info", "missing", "should not surface"),
    ]);
    const out = strip(renderDoctorReport(r));
    expect(out).toContain("Nothing to fix");
    expect(out).not.toContain("should not surface");
  });

  it("prefers warn over plain missing within the optional tier", () => {
    const r = report([
      check("ffmpeg", "required", "ok"),
      check("openai", "optional", "missing", "set OPENAI_API_KEY"),
      check("whisperx", "optional", "warn", "set HF_TOKEN"),
    ]);
    const out = strip(renderDoctorReport(r));
    // The warn item should be the focal point.
    expect(out).toContain("set HF_TOKEN");
    expect(out).not.toContain("set OPENAI_API_KEY");
  });

  it("renders a progress bar showing how many items are ready", () => {
    const r = report([
      check("ffmpeg", "required", "ok"),
      check("ffprobe", "required", "ok"),
      check("auth", "required", "missing", "ggeditor login"),
      check("openai", "optional", "missing", "set OPENAI_API_KEY"),
    ]);
    const out = strip(renderDoctorReport(r));
    // 2 of 4 actionable items pass.
    expect(out).toContain("2 of 4 ready");
  });

  it("does not output multiple checks at once in focused mode", () => {
    const r = report([
      check("ffmpeg", "required", "missing", "brew install ffmpeg"),
      check("ffprobe", "required", "missing", "brew install ffmpeg"),
      check("auth", "required", "missing", "ggeditor login"),
    ]);
    const out = strip(renderDoctorReport(r));
    // Exactly ONE 'Why it matters' block — one focal item at a time.
    const matters = out.match(/Why it matters/g) ?? [];
    expect(matters.length).toBe(1);
  });
});

describe("renderDoctorReport — all mode (--all)", () => {
  it("lists every actionable check grouped by severity", () => {
    const r = report([
      check("ffmpeg", "required", "ok"),
      check("ffprobe", "required", "missing", "brew install ffmpeg"),
      check("openai", "optional", "missing", "set OPENAI_API_KEY"),
      check("anthropic-key", "info", "missing"),
    ]);
    const out = strip(renderDoctorReport(r, { all: true }));
    expect(out).toContain("Required");
    expect(out).toContain("Optional");
    expect(out).toContain("Info");
    expect(out).toContain("ffmpeg");
    expect(out).toContain("ffprobe");
    expect(out).toContain("openai");
    expect(out).toContain("anthropic-key");
  });

  it("ends with 'Nothing to fix' summary when everything is ok", () => {
    const r = report([
      check("ffmpeg", "required", "ok"),
      check("auth", "required", "ok"),
      check("openai", "optional", "ok"),
    ]);
    const out = strip(renderDoctorReport(r, { all: true }));
    expect(out).toContain("Nothing to fix");
  });

  it("ends with a 'Next: <label>' summary when there's something to fix", () => {
    const r = report([
      check("ffmpeg", "required", "ok"),
      check("auth", "required", "missing", "ggeditor login"),
    ]);
    const out = strip(renderDoctorReport(r, { all: true }));
    expect(out).toContain("Next:");
    expect(out).toContain("auth");
  });
});
