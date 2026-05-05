import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enforceMetadataConstraints,
  generateMetadata,
  parseMetadataResponse,
} from "./youtube-metadata.js";

describe("parseMetadataResponse", () => {
  it("parses a well-formed response", () => {
    const r = parseMetadataResponse(
      JSON.stringify({
        titles: ["A", "B", "C"],
        description: "intro\n\n00:00 Intro",
        tags: ["one", "two"],
        chapters: [{ atSec: 0, title: "Intro" }],
        hashtags: ["#tag1", "tag2"],
      }),
    );
    expect(r.titles).toHaveLength(3);
    expect(r.tags).toEqual(["one", "two"]);
    expect(r.chapters[0].atSec).toBe(0);
    // hashtag without # gets one prepended
    expect(r.hashtags).toContain("#tag2");
  });

  it("strips leading # from tags", () => {
    const r = parseMetadataResponse(JSON.stringify({ tags: ["#foo", "bar"] }));
    expect(r.tags).toEqual(["foo", "bar"]);
  });

  it("drops chapter entries with bad atSec or empty title", () => {
    const r = parseMetadataResponse(
      JSON.stringify({
        chapters: [
          { atSec: 0, title: "ok" },
          { atSec: -5, title: "neg" },
          { atSec: "x", title: "bad" },
          { atSec: 30, title: "" },
        ],
      }),
    );
    expect(r.chapters).toHaveLength(1);
  });

  it("throws on absent JSON", () => {
    expect(() => parseMetadataResponse("just prose")).toThrow(/no JSON/);
  });
});

describe("enforceMetadataConstraints", () => {
  const base = {
    titles: ["t1", "t2", "t3"],
    description: "desc",
    tags: Array.from({ length: 20 }, (_, i) => `tag${i}`),
    chapters: [
      { atSec: 0, title: "Intro" },
      { atSec: 60, title: "Topic A" },
      { atSec: 120, title: "Topic B" },
      { atSec: 200, title: "Topic C" },
      { atSec: 280, title: "Topic D" },
    ],
    hashtags: ["#a", "#b", "#c", "#d", "#e", "#f"],
  };

  it("drops chapters when duration < 5 minutes", () => {
    const r = enforceMetadataConstraints(base, 200);
    expect(r.chapters).toEqual([]);
  });

  it("preserves chapters when duration >= 5 minutes and there are 5-15", () => {
    const r = enforceMetadataConstraints(base, 600);
    expect(r.chapters.length).toBeGreaterThanOrEqual(5);
    expect(r.chapters[0].atSec).toBe(0);
  });

  it("forces first chapter to atSec=0 even if LLM returned a different time", () => {
    const r = enforceMetadataConstraints(
      { ...base, chapters: [{ atSec: 5, title: "Late Intro" }, ...base.chapters.slice(1)] },
      600,
    );
    expect(r.chapters[0].atSec).toBe(0);
  });

  it("drops chapters with <30s gap", () => {
    const r = enforceMetadataConstraints(
      {
        ...base,
        chapters: [
          { atSec: 0, title: "A" },
          { atSec: 10, title: "B" }, // too close
          { atSec: 60, title: "C" },
          { atSec: 120, title: "D" },
          { atSec: 180, title: "E" },
        ],
      },
      600,
    );
    // Must have ≥ 5 entries to keep — if pruning kills it below 5 we get [].
    // After pruning B: A, C, D, E = 4 → []
    expect(r.chapters).toEqual([]);
  });

  it("caps tags at 15 and dedupes", () => {
    const r = enforceMetadataConstraints(
      { ...base, tags: ["a", "A", "b", ...base.tags] },
      200,
    );
    expect(r.tags.length).toBeLessThanOrEqual(15);
    // case-insensitive dedupe
    expect(r.tags.filter((t) => t.toLowerCase() === "a")).toHaveLength(1);
  });

  it("caps hashtags at 5", () => {
    const r = enforceMetadataConstraints(base, 200);
    expect(r.hashtags.length).toBeLessThanOrEqual(5);
  });

  it("truncates each title to 70 chars", () => {
    const long = "x".repeat(100);
    const r = enforceMetadataConstraints({ ...base, titles: [long, long, long] }, 200);
    for (const t of r.titles) expect(t.length).toBeLessThanOrEqual(70);
  });
});

describe("generateMetadata", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
  });

  it("throws without API key", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(
      generateMetadata({ language: "en", durationSec: 60, segments: [] }),
    ).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it("returns enforced metadata on success", async () => {
    process.env.OPENAI_API_KEY = "k";
    const json = {
      titles: ["A title", "B title", "C title"],
      description: "Some description",
      tags: ["tech", "ai", "shorts"],
      chapters: [{ atSec: 0, title: "Intro" }],
      hashtags: ["#ai", "#tech"],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(json) } }],
        }),
        text: async () => "",
      })) as unknown as typeof fetch,
    );
    const r = await generateMetadata({
      language: "en",
      durationSec: 200,
      segments: [{ start: 0, end: 200, text: "intro" }],
    });
    expect(r.titles).toHaveLength(3);
    // <5 min → chapters dropped
    expect(r.chapters).toEqual([]);
  });
});
