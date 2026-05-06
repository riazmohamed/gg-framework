import { describe, it, expect } from "vitest";
import { parseReportedStatus, reportedToTaskStatus } from "./orchestrator.js";

describe("parseReportedStatus", () => {
  it("matches a clean trailer", () => {
    const text = "Did the thing.\nChanged: x.ts\nVerified: pnpm test passes\nStatus: DONE";
    expect(parseReportedStatus(text)).toBe("DONE");
  });

  it("matches every grade", () => {
    for (const grade of ["DONE", "UNVERIFIED", "PARTIAL", "BLOCKED", "INFO"] as const) {
      expect(parseReportedStatus(`x\nStatus: ${grade}`)).toBe(grade);
    }
  });

  it("accepts trailing content on the same line", () => {
    expect(parseReportedStatus("x\nStatus: INFO — answered the question")).toBe("INFO");
  });

  it("picks the LAST occurrence (workers sometimes mention statuses mid-text)", () => {
    const text = "First Status: BLOCKED was wrong\nFinal answer below.\nStatus: DONE";
    expect(parseReportedStatus(text)).toBe("DONE");
  });

  it("returns null when no trailer is present", () => {
    expect(parseReportedStatus("just some text without a status line")).toBeNull();
  });

  it("returns null for unrecognised grade", () => {
    expect(parseReportedStatus("Status: COOL")).toBeNull();
  });
});

describe("reportedToTaskStatus", () => {
  it("DONE → done", () => {
    expect(reportedToTaskStatus("DONE", false)).toBe("done");
  });

  it("INFO → done (question answered, no work needed)", () => {
    expect(reportedToTaskStatus("INFO", false)).toBe("done");
  });

  it("BLOCKED → blocked", () => {
    expect(reportedToTaskStatus("BLOCKED", false)).toBe("blocked");
  });

  it("UNVERIFIED → in_progress (boss should re-prompt)", () => {
    expect(reportedToTaskStatus("UNVERIFIED", false)).toBe("in_progress");
  });

  it("PARTIAL → in_progress (boss should re-prompt for the rest)", () => {
    expect(reportedToTaskStatus("PARTIAL", false)).toBe("in_progress");
  });

  it("missing trailer + clean tools → done", () => {
    expect(reportedToTaskStatus(null, false)).toBe("done");
  });

  it("missing trailer + any tool failure → blocked", () => {
    expect(reportedToTaskStatus(null, true)).toBe("blocked");
  });

  it("DONE outranks tool failure (worker self-report wins)", () => {
    // Worker says DONE but had an incidental bash non-zero (grep no-match).
    // We trust the trailer over the heuristic — that was the whole point.
    expect(reportedToTaskStatus("DONE", true)).toBe("done");
  });
});
