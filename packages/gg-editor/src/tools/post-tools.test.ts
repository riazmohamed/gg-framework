import { describe, expect, it } from "vitest";
import { escapeFilterPath } from "./burn-subtitles.js";
import { escapeDrawtextValue } from "./compose-thumbnail.js";
import { buildConcatListBody } from "./concat-videos.js";
import { positionFormula } from "./overlay-watermark.js";

describe("positionFormula", () => {
  it("top-left places at (margin, margin)", () => {
    expect(positionFormula("top-left", 20)).toEqual({ x: "20", y: "20" });
  });
  it("top-right offsets x by W-w-margin", () => {
    expect(positionFormula("top-right", 20)).toEqual({ x: "W-w-20", y: "20" });
  });
  it("bottom-left offsets y by H-h-margin", () => {
    expect(positionFormula("bottom-left", 30)).toEqual({ x: "30", y: "H-h-30" });
  });
  it("bottom-right offsets both x and y", () => {
    expect(positionFormula("bottom-right", 10)).toEqual({
      x: "W-w-10",
      y: "H-h-10",
    });
  });
  it("center centers via (W-w)/2 and (H-h)/2", () => {
    expect(positionFormula("center", 0)).toEqual({ x: "(W-w)/2", y: "(H-h)/2" });
  });
});

describe("buildConcatListBody", () => {
  it("emits one `file '<path>'` line per input", () => {
    expect(buildConcatListBody(["/a.mp4", "/b.mp4"])).toBe("file '/a.mp4'\nfile '/b.mp4'");
  });

  it("shell-escapes embedded single quotes (POSIX form)", () => {
    // Real-world fixture from Xinrea/bili-shadowreplay: paths with a single
    // quote need ' → '\\'' escaping inside single-quoted shell strings, which
    // ffmpeg's concat demuxer parses with the same convention.
    expect(buildConcatListBody(["/dir/it's-fine.mp4"])).toBe("file '/dir/it'\\''s-fine.mp4'");
  });

  it("preserves spaces and other special chars unchanged", () => {
    expect(buildConcatListBody(["/Users/me/My Files/clip [1].mp4"])).toBe(
      "file '/Users/me/My Files/clip [1].mp4'",
    );
  });
});

describe("escapeDrawtextValue", () => {
  // Rules cross-checked against real-world fixtures: GVCLab/CutClaw,
  // g0ldyy/comet, ehendrix23/tesla_dashcam, nickslevine/budok-ai.

  it("passes plain text unchanged", () => {
    expect(escapeDrawtextValue("Hello World")).toBe("Hello World");
  });

  it("escapes single quotes", () => {
    expect(escapeDrawtextValue("don't stop")).toBe("don\\'t stop");
  });

  it("escapes colons (drawtext arg separator)", () => {
    expect(escapeDrawtextValue("note: hello")).toBe("note\\: hello");
  });

  it("escapes percent signs (drawtext expansion delimiter)", () => {
    expect(escapeDrawtextValue("50% off")).toBe("50\\% off");
  });

  it("escapes backslash FIRST so other escapes don't double up", () => {
    expect(escapeDrawtextValue("path\\to")).toBe("path\\\\to");
  });

  it("converts newlines to drawtext's literal \\n", () => {
    expect(escapeDrawtextValue("line1\nline2")).toBe("line1\\nline2");
    expect(escapeDrawtextValue("line1\r\nline2")).toBe("line1\\nline2");
  });

  it("handles a kitchen-sink string in correct order", () => {
    // Order matters: backslash first, then colon, quote, percent, newline.
    const out = escapeDrawtextValue("50% off: don't \\stop\nnow");
    expect(out).toBe("50\\% off\\: don\\'t \\\\stop\\nnow");
  });
});

describe("escapeFilterPath (subtitles= filter)", () => {
  // Cross-platform rules verified against RightNow-AI/openfang's clip skill.

  it("converts Windows backslashes to forward slashes", () => {
    expect(escapeFilterPath("C:\\Users\\me\\subs.ass")).toBe("C\\:/Users/me/subs.ass");
  });

  it("escapes the drive-letter colon", () => {
    expect(escapeFilterPath("D:/path/to/subs.srt")).toBe("D\\:/path/to/subs.srt");
  });

  it("escapes single quotes", () => {
    expect(escapeFilterPath("/Users/me/it's-here.ass")).toBe("/Users/me/it\\'s-here.ass");
  });

  it("is a no-op for plain Unix paths", () => {
    expect(escapeFilterPath("/tmp/subs.srt")).toBe("/tmp/subs.srt");
  });
});
