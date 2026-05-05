import { describe, expect, it } from "vitest";
import { buildOutline, buildWindow, parseAuditResponse } from "./retention-structure.js";
import type { Transcript } from "./whisper.js";

const FIXTURE: Transcript = {
  language: "en",
  durationSec: 600,
  segments: Array.from({ length: 30 }, (_, i) => ({
    start: i * 20,
    end: (i + 1) * 20,
    text: `segment ${i} content here some words`,
  })),
};

describe("buildWindow", () => {
  it("centres a 60s window on the requested timestamp", () => {
    const w = buildWindow(FIXTURE, 180, 600);
    expect(w.atSec).toBe(180);
    expect(w.startSec).toBe(150);
    expect(w.endSec).toBe(210);
    expect(w.text).toContain("segment");
  });

  it("clamps to [0, totalSec]", () => {
    const start = buildWindow(FIXTURE, 10, 600);
    expect(start.startSec).toBe(0);
    const end = buildWindow(FIXTURE, 590, 600);
    expect(end.endSec).toBe(600);
  });

  it("returns empty text when no segments fall inside the window", () => {
    const t: Transcript = { language: "en", durationSec: 600, segments: [] };
    const w = buildWindow(t, 180, 600);
    expect(w.text).toBe("");
  });

  it("respects custom windowSec", () => {
    const w = buildWindow(FIXTURE, 180, 600, 30);
    expect(w.startSec).toBe(165);
    expect(w.endSec).toBe(195);
  });
});

describe("buildOutline", () => {
  it("returns a stride-sampled outline with timestamps", () => {
    const out = buildOutline(FIXTURE, 10);
    expect(out.split("\n").length).toBeGreaterThan(0);
    expect(out.split("\n").length).toBeLessThanOrEqual(15);
    expect(out).toMatch(/\[\d+\.\d+s\]/);
  });

  it("returns empty string when no segments exist", () => {
    const t: Transcript = { language: "en", durationSec: 0, segments: [] };
    expect(buildOutline(t)).toBe("");
  });
});

describe("parseAuditResponse", () => {
  it("matches checkpoints to the requested order", () => {
    const content = JSON.stringify({
      checkpoints: [
        { atSec: 360, score: 0.9, summary: "twist", suggestion: "" },
        { atSec: 180, score: 0.4, summary: "flat", suggestion: "add b-roll" },
      ],
      escalationScore: 0.7,
      overallSummary: "ok",
    });
    const r = parseAuditResponse(content, [180, 360]);
    expect(r.checkpoints[0].atSec).toBe(180);
    expect(r.checkpoints[0].score).toBeCloseTo(0.4);
    expect(r.checkpoints[1].atSec).toBe(360);
    expect(r.weakestCheckpoint).toBe(180);
  });

  it("fills in placeholders when the model drops a checkpoint", () => {
    const content = JSON.stringify({
      checkpoints: [{ atSec: 180, score: 0.5, summary: "ok" }],
      escalationScore: 0.5,
      overallSummary: "",
    });
    const r = parseAuditResponse(content, [180, 360]);
    expect(r.checkpoints).toHaveLength(2);
    expect(r.checkpoints[1].score).toBe(0);
    expect(r.checkpoints[1].summary).toMatch(/no response/);
  });

  it("clamps escalationScore to [0,1]", () => {
    const content = JSON.stringify({
      checkpoints: [],
      escalationScore: 5,
      overallSummary: "",
    });
    expect(parseAuditResponse(content, []).escalationScore).toBe(1);
  });

  it("throws on non-JSON content", () => {
    expect(() => parseAuditResponse("not json", [180])).toThrow();
  });
});
