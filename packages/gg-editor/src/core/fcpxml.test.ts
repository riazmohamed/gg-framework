import { describe, expect, it } from "vitest";
import {
  buildFcpxml,
  frameRateToRational,
  framesToTime,
  totalRecordFramesFcpxml,
} from "./fcpxml.js";

describe("frameRateToRational", () => {
  it("maps 23.976 → 1001/24000", () => {
    expect(frameRateToRational(23.976)).toEqual({ num: 1001, den: 24000 });
  });
  it("maps 29.97 → 1001/30000", () => {
    expect(frameRateToRational(29.97)).toEqual({ num: 1001, den: 30000 });
  });
  it("maps 59.94 → 1001/60000", () => {
    expect(frameRateToRational(59.94)).toEqual({ num: 1001, den: 60000 });
  });
  it("maps integer rates to 1/N", () => {
    expect(frameRateToRational(24)).toEqual({ num: 1, den: 24 });
    expect(frameRateToRational(30)).toEqual({ num: 1, den: 30 });
    expect(frameRateToRational(60)).toEqual({ num: 1, den: 60 });
  });
});

describe("framesToTime", () => {
  it("returns reduced rational", () => {
    // 30 frames at 1/30s → 30/30s → reduced to 1/1s
    expect(framesToTime(30, { num: 1, den: 30 })).toBe("1/1s");
  });
  it("handles zero", () => {
    expect(framesToTime(0, { num: 1, den: 30 })).toBe("0/1s");
  });
  it("handles 23.976 frame", () => {
    // 24 frames at 1001/24000s → 24024/24000s → reduce by 24 → 1001/1000s
    expect(framesToTime(24, { num: 1001, den: 24000 })).toBe("1001/1000s");
  });
});

describe("buildFcpxml", () => {
  it("emits valid FCPXML 1.10 with one asset and one clip", () => {
    const out = buildFcpxml({
      title: "Test",
      frameRate: 30,
      events: [
        {
          reel: "podcast",
          sourcePath: "/path/podcast.mp4",
          sourceInFrame: 0,
          sourceOutFrame: 30,
          clipName: "intro",
        },
      ],
    });
    expect(out).toContain('<fcpxml version="1.10">');
    expect(out).toContain('<format id="r1"');
    expect(out).toContain('<asset id="r2"');
    expect(out).toContain("file:///path/podcast.mp4");
    expect(out).toContain('<asset-clip ref="r2"');
    expect(out).toContain('name="intro"');
  });

  it("places events contiguously on the spine", () => {
    const out = buildFcpxml({
      title: "T",
      frameRate: 30,
      events: [
        { reel: "src", sourcePath: "/x.mp4", sourceInFrame: 0, sourceOutFrame: 30 },
        { reel: "src", sourcePath: "/x.mp4", sourceInFrame: 90, sourceOutFrame: 120 },
      ],
    });
    // Event 1: offset=0, duration=1s, start=0
    expect(out).toMatch(/offset="0\/1s" start="0\/1s" duration="1\/1s"/);
    // Event 2: offset=1s (continues), duration=1s, start=3s (90/30)
    expect(out).toMatch(/offset="1\/1s" start="3\/1s" duration="1\/1s"/);
  });

  it("creates one asset per unique reel", () => {
    const out = buildFcpxml({
      title: "T",
      frameRate: 30,
      events: [
        { reel: "a", sourcePath: "/a.mp4", sourceInFrame: 0, sourceOutFrame: 30 },
        { reel: "b", sourcePath: "/b.mp4", sourceInFrame: 0, sourceOutFrame: 30 },
      ],
    });
    expect(out).toContain('<asset id="r2"');
    expect(out).toContain('<asset id="r3"');
    expect(out).toContain("/a.mp4");
    expect(out).toContain("/b.mp4");
  });

  it("rejects empty event lists", () => {
    expect(() => buildFcpxml({ title: "T", frameRate: 30, events: [] })).toThrow(
      /events must not be empty/,
    );
  });

  it("rejects zero or negative durations", () => {
    expect(() =>
      buildFcpxml({
        title: "T",
        frameRate: 30,
        events: [{ reel: "a", sourcePath: "/a.mp4", sourceInFrame: 30, sourceOutFrame: 30 }],
      }),
    ).toThrow(/sourceOutFrame must be > sourceInFrame/);
  });

  it("xml-escapes title, reel, and clipName", () => {
    const out = buildFcpxml({
      title: 'Tom & "Jerry"',
      frameRate: 30,
      events: [
        {
          reel: "weird<reel>",
          sourcePath: "/x.mp4",
          sourceInFrame: 0,
          sourceOutFrame: 30,
          clipName: "name with & ampersand",
        },
      ],
    });
    expect(out).toContain("Tom &amp; &quot;Jerry&quot;");
    expect(out).toContain("weird&lt;reel&gt;");
    expect(out).toContain("name with &amp; ampersand");
  });

  it("converts Windows paths to file:// URLs", () => {
    const out = buildFcpxml({
      title: "T",
      frameRate: 30,
      events: [
        { reel: "x", sourcePath: "C:\\Users\\me\\video.mp4", sourceInFrame: 0, sourceOutFrame: 30 },
      ],
    });
    expect(out).toContain("file:///C:/Users/me/video.mp4");
  });
});

describe("totalRecordFramesFcpxml", () => {
  it("sums event durations", () => {
    expect(
      totalRecordFramesFcpxml([
        { reel: "a", sourcePath: "/a", sourceInFrame: 0, sourceOutFrame: 30 },
        { reel: "a", sourcePath: "/a", sourceInFrame: 100, sourceOutFrame: 150 },
      ]),
    ).toBe(80);
  });
});
