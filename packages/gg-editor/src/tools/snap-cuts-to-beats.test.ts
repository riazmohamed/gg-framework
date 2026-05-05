import { describe, expect, it, vi, beforeEach } from "vitest";
import * as beatsCore from "../core/beats.js";
import * as pythonMod from "../core/python.js";
import { createSnapCutsToBeatsTool } from "./snap-cuts-to-beats.js";

const ctx = {
  signal: new AbortController().signal,
  toolCallId: "t1",
} as unknown as Parameters<ReturnType<typeof createSnapCutsToBeatsTool>["execute"]>[1];

describe("snap_cuts_to_beats tool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns python-missing error when findPython fails", async () => {
    vi.spyOn(pythonMod, "findPython").mockReturnValue(undefined);
    const tool = createSnapCutsToBeatsTool("/tmp");
    const r = await tool.execute(
      { audio: "song.wav", cutPoints: [1.0] },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r).toMatch(/^error:/);
    expect(r).toMatch(/Python 3 not on PATH/);
    expect(r).toMatch(/pip install librosa/);
  });

  it("formats successful output as compact JSON with snapped + unchanged", async () => {
    vi.spyOn(pythonMod, "findPython").mockReturnValue({ cmd: "python3", args: [] });
    vi.spyOn(beatsCore, "detectBeats").mockResolvedValue({
      tempo: 120.5,
      beats: [1.0, 2.0, 3.0, 4.0],
      durationSec: 5.0,
    });
    const tool = createSnapCutsToBeatsTool("/tmp");
    const r = await tool.execute(
      { audio: "song.wav", cutPoints: [1.05, 2.5, 4.02] },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(typeof r).toBe("string");
    const parsed = JSON.parse(r as string);
    expect(parsed.tempo).toBe(120.5);
    expect(parsed.totalBeats).toBe(4);
    expect(parsed.toleranceSec).toBe(0.25);
    // 1.05 → 1.0 (delta -0.05), 4.02 → 4.0 (delta -0.02), 2.5 → unchanged (0.5 from each).
    expect(parsed.snapped).toHaveLength(2);
    expect(parsed.snapped[0]).toEqual({
      originalSec: 1.05,
      snappedSec: 1.0,
      deltaSec: -0.05,
      beatIdx: 0,
    });
    expect(parsed.unchanged).toHaveLength(1);
    expect(parsed.unchanged[0].atSec).toBe(2.5);
    expect(parsed.unchanged[0].nearestBeatDeltaSec).toBe(0.5);
  });

  it("respects custom tolerance", async () => {
    vi.spyOn(pythonMod, "findPython").mockReturnValue({ cmd: "python3", args: [] });
    vi.spyOn(beatsCore, "detectBeats").mockResolvedValue({
      tempo: 60,
      beats: [0, 1, 2, 3],
      durationSec: 4,
    });
    const tool = createSnapCutsToBeatsTool("/tmp");
    const r = await tool.execute(
      { audio: "x.wav", cutPoints: [0.5], toleranceSec: 0.6 },
      ctx as Parameters<typeof tool.execute>[1],
    );
    const parsed = JSON.parse(r as string);
    expect(parsed.toleranceSec).toBe(0.6);
    // 0.5 within 0.6 tol of beat 0 → snaps to 0.
    expect(parsed.snapped).toHaveLength(1);
    expect(parsed.snapped[0].snappedSec).toBe(0);
  });

  it("returns no-beats error when sidecar reports an empty list", async () => {
    vi.spyOn(pythonMod, "findPython").mockReturnValue({ cmd: "python3", args: [] });
    vi.spyOn(beatsCore, "detectBeats").mockResolvedValue({
      tempo: 0,
      beats: [],
      durationSec: 5,
    });
    const tool = createSnapCutsToBeatsTool("/tmp");
    const r = await tool.execute(
      { audio: "silent.wav", cutPoints: [1] },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r).toMatch(/^error:/);
    expect(r).toMatch(/no beats detected/);
    expect(r).toMatch(/raw cut points stand/);
  });

  it("propagates a missing-dep sidecar error with the pip-install fix", async () => {
    vi.spyOn(pythonMod, "findPython").mockReturnValue({ cmd: "python3", args: [] });
    vi.spyOn(beatsCore, "detectBeats").mockRejectedValue(
      new Error("missing python dep: librosa; install librosa numpy soundfile"),
    );
    const tool = createSnapCutsToBeatsTool("/tmp");
    const r = await tool.execute(
      { audio: "x.wav", cutPoints: [1] },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r).toMatch(/^error:/);
    expect(r).toMatch(/missing python dep: librosa/);
    expect(r).toMatch(/pip install librosa numpy soundfile/);
  });

  it("propagates a malformed-output sidecar error", async () => {
    vi.spyOn(pythonMod, "findPython").mockReturnValue({ cmd: "python3", args: [] });
    vi.spyOn(beatsCore, "detectBeats").mockRejectedValue(
      new Error("beat sidecar returned malformed output: garbage | stderr: warn"),
    );
    const tool = createSnapCutsToBeatsTool("/tmp");
    const r = await tool.execute(
      { audio: "x.wav", cutPoints: [1] },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r).toMatch(/^error:/);
    expect(r).toMatch(/malformed output/);
  });

  it("zod rejects an empty cutPoints array", async () => {
    const tool = createSnapCutsToBeatsTool("/tmp");
    // The agent SDK normally validates before execute; here we exercise zod directly.
    const r = tool.parameters.safeParse({ audio: "x.wav", cutPoints: [] });
    expect(r.success).toBe(false);
  });
});
