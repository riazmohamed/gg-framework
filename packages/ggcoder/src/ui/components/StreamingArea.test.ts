import { describe, expect, it } from "vitest";
import { getStreamingTextPreview } from "./StreamingArea.js";

describe("getStreamingTextPreview", () => {
  it("leaves short streaming text intact", () => {
    const text = "short answer\nwith two lines";

    expect(getStreamingTextPreview(text, 80)).toEqual({ text, isTruncated: false });
  });

  it("replaces long streaming text with a stable placeholder", () => {
    const text = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join("\n");
    const preview = getStreamingTextPreview(text, 80);

    expect(preview).toEqual({ text: "", isTruncated: true });
  });

  it("hard-caps a single huge line so it cannot grow the live Ink area unbounded", () => {
    const preview = getStreamingTextPreview("x".repeat(2_000), 20);

    expect(preview).toEqual({ text: "", isTruncated: true });
  });
});
