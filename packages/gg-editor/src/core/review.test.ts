import { describe, expect, it } from "vitest";
import { parseReviewMessage } from "./review.js";

describe("parseReviewMessage", () => {
  it("extracts critique and flags from a well-formed message", () => {
    const text = `The edit keeps too many filler words around 02:13–02:30 and the hook lacks energy.

\`\`\`json
{"flags":[{"severity":"warn","note":"filler at 02:13"},{"severity":"block","note":"missing captions"}]}
\`\`\``;
    const r = parseReviewMessage(text);
    expect(r.critique).toContain("filler words");
    expect(r.critique).not.toContain("```");
    expect(r.flags).toHaveLength(2);
    expect(r.flags[0]).toEqual({ severity: "warn", note: "filler at 02:13" });
    expect(r.flags[1]).toEqual({ severity: "block", note: "missing captions" });
  });

  it("returns whole message as critique with empty flags on no JSON block", () => {
    const text = "Looks fine to me.";
    const r = parseReviewMessage(text);
    expect(r.critique).toBe("Looks fine to me.");
    expect(r.flags).toEqual([]);
  });

  it("falls back gracefully on malformed JSON", () => {
    const text = "Bad block follows.\n\n```json\n{not valid\n```";
    const r = parseReviewMessage(text);
    expect(r.critique).toContain("Bad block follows");
    expect(r.flags).toEqual([]);
  });

  it("drops flags with unknown severity", () => {
    const text = `Ok.

\`\`\`json
{"flags":[{"severity":"warn","note":"a"},{"severity":"nope","note":"b"}]}
\`\`\``;
    const r = parseReviewMessage(text);
    expect(r.flags).toEqual([{ severity: "warn", note: "a" }]);
  });

  it("tolerates trailing whitespace after the JSON fence", () => {
    // LLMs sometimes append a blank line after the closing fence.
    const text = [
      "Looks tight.",
      "",
      "```json",
      '{"flags":[{"severity":"ok","note":"good pacing"}]}',
      "```",
      "  ",
      "",
    ].join("\n");
    const r = parseReviewMessage(text);
    expect(r.flags).toEqual([{ severity: "ok", note: "good pacing" }]);
  });

  it("drops flags missing required fields", () => {
    const text = [
      "x",
      "",
      "```json",
      '{"flags":[{"severity":"warn"},{"note":"orphan note"},{"severity":"warn","note":"keep"}]}',
      "```",
    ].join("\n");
    const r = parseReviewMessage(text);
    expect(r.flags).toEqual([{ severity: "warn", note: "keep" }]);
  });

  it("handles empty flags array", () => {
    const text = ["All clear.", "", "```json", '{"flags":[]}', "```"].join("\n");
    const r = parseReviewMessage(text);
    expect(r.flags).toEqual([]);
    expect(r.critique).toBe("All clear.");
  });

  it("handles missing flags key entirely", () => {
    // Some models emit { } without the flags key.
    const text = `summary\n\n\`\`\`json\n{}\n\`\`\``;
    const r = parseReviewMessage(text);
    expect(r.flags).toEqual([]);
  });
});
