import { describe, expect, it } from "vitest";
import { assColor, buildAss, formatAssTime } from "./ass.js";

describe("formatAssTime", () => {
  it("formats zero", () => {
    expect(formatAssTime(0)).toBe("0:00:00.00");
  });
  it("uses centiseconds, not milliseconds", () => {
    expect(formatAssTime(1.234)).toBe("0:00:01.23");
  });
  it("formats hours+minutes+seconds+cs", () => {
    expect(formatAssTime(3661.99)).toBe("1:01:01.99");
  });
  it("clamps negatives to zero", () => {
    expect(formatAssTime(-5)).toBe("0:00:00.00");
  });
});

describe("assColor", () => {
  it("converts RRGGBB to &HAABBGGRR& with opaque alpha", () => {
    expect(assColor("FF0000")).toBe("&H000000FF&"); // pure red
    expect(assColor("00FF00")).toBe("&H0000FF00&"); // pure green
    expect(assColor("0000FF")).toBe("&H00FF0000&"); // pure blue
    expect(assColor("FFFFFF")).toBe("&H00FFFFFF&"); // white
  });
  it("inverts CSS alpha to ASS alpha", () => {
    // CSS FF (fully opaque) → ASS 00 (fully opaque)
    expect(assColor("FFFFFFFF")).toBe("&H00FFFFFF&");
    // CSS 00 (fully transparent) → ASS FF (fully transparent)
    expect(assColor("FFFFFF00")).toBe("&HFFFFFFFF&");
  });
  it("accepts a leading #", () => {
    expect(assColor("#FF0000")).toBe("&H000000FF&");
  });
  it("rejects bad input", () => {
    expect(() => assColor("nope")).toThrow();
    expect(() => assColor("FFFFF")).toThrow();
  });
});

describe("buildAss", () => {
  const minStyles = [{ name: "Default" }];

  it("requires a Default style", () => {
    expect(() => buildAss({ styles: [{ name: "Other" }], cues: [] })).toThrow(/Default/);
  });

  it("emits Script Info, V4+ Styles, and Events sections", () => {
    const out = buildAss({
      styles: minStyles,
      cues: [{ start: 1, end: 2, text: "hi" }],
    });
    expect(out).toContain("[Script Info]");
    expect(out).toContain("[V4+ Styles]");
    expect(out).toContain("[Events]");
  });

  it("escapes newlines as \\N", () => {
    const out = buildAss({
      styles: minStyles,
      cues: [{ start: 0, end: 1, text: "line1\nline2" }],
    });
    expect(out).toContain("line1\\Nline2");
  });

  it("rejects cues whose end <= start", () => {
    expect(() => buildAss({ styles: minStyles, cues: [{ start: 5, end: 5, text: "x" }] })).toThrow(
      /must be > start/,
    );
  });

  it("rejects cues that reference an undefined style", () => {
    expect(() =>
      buildAss({
        styles: minStyles,
        cues: [{ start: 0, end: 1, text: "x", style: "ghost" }],
      }),
    ).toThrow(/unknown style: ghost/);
  });

  it("uses 1080x1920 vertical canvas when supplied", () => {
    const out = buildAss({
      playResX: 1080,
      playResY: 1920,
      styles: minStyles,
      cues: [{ start: 0, end: 1, text: "hi" }],
    });
    expect(out).toContain("PlayResX: 1080");
    expect(out).toContain("PlayResY: 1920");
  });

  it("emits one Dialogue line per cue with H:MM:SS.cc times", () => {
    const out = buildAss({
      styles: minStyles,
      cues: [
        { start: 1, end: 2.5, text: "first" },
        { start: 3, end: 4, text: "second" },
      ],
    });
    expect(out).toContain("Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,first");
    expect(out).toContain("Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,second");
  });

  it("respects per-style font + alignment + margin overrides", () => {
    const out = buildAss({
      styles: [
        {
          name: "Default",
          fontName: "Impact",
          fontSize: 96,
          alignment: 5,
          marginV: 200,
          outline: 4,
          bold: true,
        },
      ],
      cues: [{ start: 0, end: 1, text: "hi" }],
    });
    expect(out).toContain("Impact");
    expect(out).toContain(",96,");
    // alignment 5 (center), marginV 200, outline 4, bold -1
    expect(out).toMatch(/,4,0,5,/);
    expect(out).toMatch(/,200,/);
    expect(out).toMatch(/,-1,0,0,0,/); // bold,italic,underline,strikeout
  });
});
