import { describe, expect, it } from "vitest";
import type { TimelineState } from "../types.js";
import { reorderToEvents } from "./reorder.js";

function makeTimeline(): TimelineState {
  return {
    name: "test",
    frameRate: 30,
    durationFrames: 300,
    clips: [
      {
        id: "c1",
        track: 1,
        trackKind: "video",
        startFrame: 0,
        endFrame: 60,
        name: "first",
        sourcePath: "/a.mov",
      },
      {
        id: "c2",
        track: 1,
        trackKind: "video",
        startFrame: 60,
        endFrame: 120,
        name: "second",
        sourcePath: "/b.mov",
      },
      {
        id: "c3",
        track: 1,
        trackKind: "video",
        startFrame: 120,
        endFrame: 180,
        name: "third",
        sourcePath: "/c.mov",
      },
    ],
    markers: [],
  };
}

describe("reorderToEvents", () => {
  it("identity reorder preserves original sequence", () => {
    const t = makeTimeline();
    const events = reorderToEvents({ current: t, newOrder: ["c1", "c2", "c3"] });
    expect(events.map((e) => e.clipName)).toEqual(["first", "second", "third"]);
  });

  it("full reverse reorder", () => {
    const t = makeTimeline();
    const events = reorderToEvents({ current: t, newOrder: ["c3", "c2", "c1"] });
    expect(events.map((e) => e.clipName)).toEqual(["third", "second", "first"]);
  });

  it("partial reorder appends missing clips at the end in original order", () => {
    const t = makeTimeline();
    const events = reorderToEvents({ current: t, newOrder: ["c2"] });
    // c2 first, then c1 + c3 in their original order.
    expect(events.map((e) => e.clipName)).toEqual(["second", "first", "third"]);
  });

  it("throws when newOrder references unknown clipId", () => {
    const t = makeTimeline();
    expect(() => reorderToEvents({ current: t, newOrder: ["c1", "no-such"] })).toThrow(/not found/);
  });

  it("ignores audio-track clips entirely", () => {
    const t = makeTimeline();
    t.clips.push({
      id: "audioOnly",
      track: 1,
      trackKind: "audio",
      startFrame: 0,
      endFrame: 100,
      name: "voice",
      sourcePath: "/voice.wav",
    });
    const events = reorderToEvents({ current: t, newOrder: ["c1", "c2", "c3"] });
    expect(events).toHaveLength(3);
    expect(events.find((e) => e.reel === "/voice.wav")).toBeUndefined();
  });

  it("uses sourcePathByClipId override when ClipInfo lacks sourcePath", () => {
    const t = makeTimeline();
    t.clips[0].sourcePath = undefined;
    const events = reorderToEvents({
      current: t,
      newOrder: ["c1"],
      sourcePathByClipId: { c1: "/override.mov" },
    });
    expect(events[0].reel).toBe("/override.mov");
    expect(events[0].sourcePath).toBe("/override.mov");
  });
});
