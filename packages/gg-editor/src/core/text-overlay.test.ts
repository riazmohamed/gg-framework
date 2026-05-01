import { describe, expect, it } from "vitest";
import { buildLowerThirdAss, buildTitleCardAss } from "./text-overlay.js";

describe("buildLowerThirdAss", () => {
  it("rejects empty list", () => {
    expect(() => buildLowerThirdAss([], { width: 1920, height: 1080 })).toThrow(/empty/);
  });

  it("emits a slide-left lower-third with \\move + \\fad", () => {
    const ass = buildLowerThirdAss(
      [
        {
          primaryText: "Jane Doe",
          secondaryText: "Director",
          startSec: 1,
          durationSec: 3,
          position: "bottom-left",
          animation: "slide-left",
          marginPx: 80,
        },
      ],
      { width: 1920, height: 1080 },
    );
    expect(ass).toContain("[V4+ Styles]");
    // \move from off-canvas-left to (80, 1000) — bottom-left anchor.
    expect(ass).toMatch(/\\move\(-1920,1000,80,1000,0,500\)/);
    expect(ass).toContain("\\fad(250,250)");
    expect(ass).toContain("Jane Doe\\NDirector");
    expect(ass).toMatch(/\\an1/);
  });

  it("uses \\pos (not \\move) for fade animation", () => {
    const ass = buildLowerThirdAss(
      [
        {
          primaryText: "Hello",
          startSec: 0,
          durationSec: 2,
          position: "bottom-center",
          animation: "fade",
        },
      ],
      { width: 1920, height: 1080 },
    );
    expect(ass).toMatch(/\\pos\(960,1000\)/);
    expect(ass).not.toContain("\\move");
    expect(ass).toMatch(/\\an2/);
  });

  it("supports top-right alignment", () => {
    const ass = buildLowerThirdAss(
      [
        {
          primaryText: "Note",
          startSec: 0,
          durationSec: 1,
          position: "top-right",
          animation: "none",
          marginPx: 40,
        },
      ],
      { width: 1920, height: 1080 },
    );
    expect(ass).toMatch(/\\an9/);
    // top-right anchor at (1880, 40).
    expect(ass).toMatch(/\\pos\(1880,40\)/);
  });

  it("emits primary and accent color overrides as ASS &Hbbggrr&", () => {
    const ass = buildLowerThirdAss(
      [
        {
          primaryText: "Jane",
          startSec: 0,
          durationSec: 1,
          primaryColor: "FF0000",
          accentColor: "000000",
          animation: "fade",
        },
      ],
      { width: 1920, height: 1080 },
    );
    // Red primary: ASS BGR = &H000000FF& with alpha 00.
    expect(ass).toMatch(/\\c&H000000FF&/);
    expect(ass).toMatch(/\\3c&H00000000&/);
  });

  it("rejects zero/negative duration", () => {
    expect(() =>
      buildLowerThirdAss([{ primaryText: "x", startSec: 0, durationSec: 0 }], {
        width: 1920,
        height: 1080,
      }),
    ).toThrow();
  });
});

describe("buildTitleCardAss", () => {
  it("rejects empty list", () => {
    expect(() => buildTitleCardAss([], { width: 1920, height: 1080 })).toThrow(/empty/);
  });

  it("default fade-in-out title card", () => {
    const ass = buildTitleCardAss([{ text: "Chapter 1", startSec: 0, durationSec: 4 }], {
      width: 1920,
      height: 1080,
    });
    expect(ass).toContain("\\fad(400,400)");
    expect(ass).toContain("Chapter 1");
  });

  it("zoom-in title card emits \\t scale tween", () => {
    const ass = buildTitleCardAss(
      [{ text: "Big", startSec: 0, durationSec: 2, animation: "zoom-in" }],
      { width: 1920, height: 1080 },
    );
    // Initial 70% scale, animate to 100% over half the duration.
    expect(ass).toMatch(/\\fscx70\\fscy70/);
    expect(ass).toMatch(/\\t\(0,1000,\\fscx100\\fscy100\)/);
  });

  it("respects custom font size override on the cue (\\fs)", () => {
    const ass = buildTitleCardAss([{ text: "X", startSec: 0, durationSec: 1, fontSize: 200 }], {
      width: 1920,
      height: 1080,
    });
    expect(ass).toMatch(/\\fs200/);
  });
});
