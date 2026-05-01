import { describe, expect, it, vi, beforeEach } from "vitest";
import * as ffmpeg from "./media/ffmpeg.js";
import { multicamSync } from "./multicam.js";

function silenceStderr(endSec: number | null): string {
  if (endSec === null) return "";
  return `[silencedetect @ 0x1] silence_start: 0.0\n[silencedetect @ 0x1] silence_end: ${endSec} | silence_duration: ${endSec}\n`;
}

describe("multicamSync", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("picks the input with the smallest transient as reference", async () => {
    // a=2.0s, b=0.5s, c=1.2s — b should be reference (smallest).
    const map: Record<string, number | null> = { "/a.wav": 2.0, "/b.wav": 0.5, "/c.wav": 1.2 };
    vi.spyOn(ffmpeg, "runFfmpeg").mockImplementation(async (args) => {
      const path = args[args.indexOf("-i") + 1];
      return { code: 0, stdout: "", stderr: silenceStderr(map[path] ?? null) };
    });
    const r = await multicamSync(["/a.wav", "/b.wav", "/c.wav"]);
    expect(r.reference).toBe("/b.wav");
    expect(r.warning).toBeUndefined();
    const byPath = Object.fromEntries(r.results.map((x) => [x.path, x.offsetSec]));
    expect(byPath["/b.wav"]).toBe(0);
    expect(byPath["/a.wav"]).toBeCloseTo(1.5);
    expect(byPath["/c.wav"]).toBeCloseTo(0.7);
  });

  it("emits a warning and null offset for files with no transient", async () => {
    const map: Record<string, number | null> = { "/x.wav": 1.0, "/y.wav": null };
    vi.spyOn(ffmpeg, "runFfmpeg").mockImplementation(async (args) => {
      const path = args[args.indexOf("-i") + 1];
      return { code: 0, stdout: "", stderr: silenceStderr(map[path] ?? null) };
    });
    const r = await multicamSync(["/x.wav", "/y.wav"]);
    expect(r.reference).toBe("/x.wav");
    const yResult = r.results.find((x) => x.path === "/y.wav");
    expect(yResult?.offsetSec).toBeNull();
    expect(yResult?.transientSec).toBeNull();
    expect(r.warning).toMatch(/no transient detected for 1 of 2/);
  });

  it("trivially handles a single-file input", async () => {
    vi.spyOn(ffmpeg, "runFfmpeg").mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: silenceStderr(0.8),
    });
    const r = await multicamSync(["/solo.wav"]);
    expect(r.reference).toBe("/solo.wav");
    expect(r.results).toHaveLength(1);
    expect(r.results[0].offsetSec).toBe(0);
  });

  it("rejects empty input", async () => {
    await expect(multicamSync([])).rejects.toThrow(/empty/);
  });
});
