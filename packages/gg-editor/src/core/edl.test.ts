import { describe, expect, it } from "vitest";
import { buildEdl, totalRecordFrames } from "./edl.js";

describe("buildEdl", () => {
  it("emits a valid CMX 3600 header", () => {
    const out = buildEdl({ title: "Test", frameRate: 30, events: [] });
    expect(out).toContain("TITLE: Test");
    expect(out).toContain("FCM: NON-DROP FRAME");
  });

  it("places events contiguously on the record timeline", () => {
    const out = buildEdl({
      title: "T",
      frameRate: 30,
      events: [
        { reel: "src1", track: "V", sourceInFrame: 0, sourceOutFrame: 30 },
        { reel: "src1", track: "V", sourceInFrame: 90, sourceOutFrame: 120 },
      ],
    });
    // Event 1: src 00:00:00:00 → 00:00:01:00, rec 00:00:00:00 → 00:00:01:00
    expect(out).toContain(
      "001  src1      V      C        00:00:00:00 00:00:01:00 00:00:00:00 00:00:01:00",
    );
    // Event 2: src 00:00:03:00 → 00:00:04:00, rec 00:00:01:00 → 00:00:02:00 (continues from prev)
    expect(out).toContain(
      "002  src1      V      C        00:00:03:00 00:00:04:00 00:00:01:00 00:00:02:00",
    );
  });

  it("writes clip name comments", () => {
    const out = buildEdl({
      title: "T",
      frameRate: 30,
      events: [
        { reel: "src1", track: "V", sourceInFrame: 0, sourceOutFrame: 30, clipName: "hello.mp4" },
      ],
    });
    expect(out).toContain("* FROM CLIP NAME: hello.mp4");
  });

  it("rejects zero or negative durations", () => {
    expect(() =>
      buildEdl({
        title: "T",
        frameRate: 30,
        events: [{ reel: "src1", track: "V", sourceInFrame: 30, sourceOutFrame: 30 }],
      }),
    ).toThrow(/must be > sourceInFrame/);
  });

  it("truncates reel to 8 chars and replaces whitespace", () => {
    const out = buildEdl({
      title: "T",
      frameRate: 30,
      events: [{ reel: "my source clip", track: "V", sourceInFrame: 0, sourceOutFrame: 30 }],
    });
    // "my_sourc" — 8 chars, underscores
    expect(out).toMatch(/001 {2}my_sourc/);
  });

  it("supports drop-frame timecode flag", () => {
    const out = buildEdl({ title: "T", frameRate: 29.97, events: [], dropFrame: true });
    expect(out).toContain("FCM: DROP FRAME");
  });
});

describe("totalRecordFrames", () => {
  it("sums per-event durations", () => {
    expect(
      totalRecordFrames([
        { reel: "a", track: "V", sourceInFrame: 0, sourceOutFrame: 30 },
        { reel: "a", track: "V", sourceInFrame: 100, sourceOutFrame: 200 },
      ]),
    ).toBe(130);
  });
});
