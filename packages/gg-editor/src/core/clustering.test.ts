import { describe, expect, it } from "vitest";
import { clusterSegments, jaccard, tokenize } from "./clustering.js";

describe("tokenize", () => {
  it("lowercases and strips punctuation", () => {
    const t = tokenize("Hello, World! It's GREAT.");
    expect(t.has("hello")).toBe(true);
    expect(t.has("world")).toBe(true);
    expect(t.has("great")).toBe(true);
    expect(t.has("it's")).toBe(true);
  });

  it("drops stopwords and filler", () => {
    const t = tokenize("um the quick brown fox like yeah");
    expect(t.has("um")).toBe(false);
    expect(t.has("the")).toBe(false);
    expect(t.has("like")).toBe(false);
    expect(t.has("yeah")).toBe(false);
    expect(t.has("quick")).toBe(true);
    expect(t.has("brown")).toBe(true);
    expect(t.has("fox")).toBe(true);
  });

  it("drops single-character tokens", () => {
    const t = tokenize("a b cat dog");
    expect(t.has("a")).toBe(false);
    expect(t.has("b")).toBe(false);
    expect(t.has("cat")).toBe(true);
  });
});

describe("jaccard", () => {
  it("returns 0 for disjoint sets", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["c", "d"]))).toBe(0);
  });
  it("returns 1 for identical sets", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
  });
  it("computes intersection / union", () => {
    // {a,b,c} ∩ {b,c,d} = {b,c} = 2
    // {a,b,c} ∪ {b,c,d} = {a,b,c,d} = 4
    expect(jaccard(new Set(["a", "b", "c"]), new Set(["b", "c", "d"]))).toBe(0.5);
  });
});

describe("clusterSegments", () => {
  it("groups identical re-takes", () => {
    const segs = [
      { start: 0, end: 3, text: "Hello everyone, welcome to the show today" },
      { start: 5, end: 7, text: "this is just other content here" },
      { start: 10, end: 13, text: "Hello everyone, welcome to the show" },
      { start: 15, end: 18, text: "Hello everyone! Welcome to today's show" },
    ];
    const clusters = clusterSegments(segs, { threshold: 0.5 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].memberIndexes).toEqual([0, 2, 3]);
    expect(clusters[0].members[0].start).toBe(0);
  });

  it("excludes singletons by default", () => {
    const segs = [
      { start: 0, end: 1, text: "First unique segment about apples" },
      { start: 2, end: 3, text: "Second different topic about cars" },
    ];
    expect(clusterSegments(segs)).toHaveLength(0);
  });

  it("includes singletons when requested", () => {
    const segs = [
      { start: 0, end: 1, text: "First unique segment about apples" },
      { start: 2, end: 3, text: "Second different topic about cars" },
    ];
    const r = clusterSegments(segs, { includeSingletons: true });
    expect(r.length).toBeGreaterThanOrEqual(2);
  });

  it("respects the comparison window", () => {
    const segs = [
      { start: 0, end: 1, text: "the unique alpha beta gamma delta marker phrase" },
      // Use distinct fillers so adjacent fillers don't cluster with each other.
      // Each pulls from a long pool of unique words.
      ...Array.from({ length: 200 }, (_, i) => ({
        start: 2 + i,
        end: 3 + i,
        text: `unrelated${i} discussion${i} subject${i} other${i} different${i}`,
      })),
      { start: 300, end: 301, text: "the unique alpha beta gamma delta marker phrase" },
    ];
    // With window=10, the two matching takes can't link (too far apart).
    const r = clusterSegments(segs, { window: 10, threshold: 0.5 });
    expect(
      r.find((c) => c.memberIndexes.includes(0) && c.memberIndexes.includes(201)),
    ).toBeUndefined();
    // With window=300+, they link.
    const r2 = clusterSegments(segs, { window: 500, threshold: 0.5 });
    const matchingCluster = r2.find(
      (c) => c.memberIndexes.includes(0) && c.memberIndexes.includes(201),
    );
    expect(matchingCluster).toBeDefined();
  });

  it("skips segments below minTokens threshold", () => {
    const segs = [
      { start: 0, end: 1, text: "yes" },
      { start: 2, end: 3, text: "yes" },
      { start: 4, end: 5, text: "yes" },
    ];
    expect(clusterSegments(segs, { minTokens: 4 })).toHaveLength(0);
  });

  it("sorts clusters temporally", () => {
    const segs = [
      { start: 0, end: 1, text: "alpha beta gamma delta first cluster phrase" },
      { start: 2, end: 3, text: "epsilon zeta eta theta second different group" },
      { start: 4, end: 5, text: "alpha beta gamma delta first cluster phrase" },
      { start: 6, end: 7, text: "epsilon zeta eta theta second different group" },
    ];
    const r = clusterSegments(segs, { threshold: 0.5 });
    expect(r).toHaveLength(2);
    expect(r[0].memberIndexes).toEqual([0, 2]); // first temporally
    expect(r[1].memberIndexes).toEqual([1, 3]);
    expect(r[0].id).toBe(1);
    expect(r[1].id).toBe(2);
  });
});
