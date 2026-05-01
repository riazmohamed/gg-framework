/**
 * Round-trip golden tests for the EDL writer.
 *
 * We don't ship a full EDL parser (no agent reads EDLs), so we use targeted
 * regexes to pull (event, reel, track, srcIn, srcOut, recIn, recOut) back
 * out of our own output and verify the structural invariants:
 *
 *   - One event line per input event, in order, with monotonically increasing event numbers
 *   - Source frames round-trip via framesToTimecode
 *   - Record frames are contiguous (recIn[N] == recOut[N-1])
 *   - Reel + track padding is preserved
 *   - Clip-name comments appear on the right event lines
 *
 * These give us a real regression net for any future edit to the EDL emitter.
 */
import { describe, expect, it } from "vitest";
import { buildEdl, type EdlEvent } from "./edl.js";
import { framesToTimecode } from "./format.js";

const EVENT_RE =
  /^(\d{3})\s{2}(.{8})\s{2}(.{5})\s{2}C\s{8}(\d{2}:\d{2}:\d{2}:\d{2}) (\d{2}:\d{2}:\d{2}:\d{2}) (\d{2}:\d{2}:\d{2}:\d{2}) (\d{2}:\d{2}:\d{2}:\d{2})$/;

interface ParsedEvent {
  num: number;
  reel: string;
  track: string;
  srcIn: string;
  srcOut: string;
  recIn: string;
  recOut: string;
  clipName?: string;
}

function parseEdl(edl: string): { title: string; fcm: string; events: ParsedEvent[] } {
  const lines = edl.split("\n");
  let title = "";
  let fcm = "";
  const events: ParsedEvent[] = [];
  let pending: ParsedEvent | null = null;

  for (const line of lines) {
    if (line.startsWith("TITLE:")) title = line.slice(6).trim();
    else if (line.startsWith("FCM:")) fcm = line.slice(4).trim();
    else if (line.startsWith("* FROM CLIP NAME:") && pending) {
      pending.clipName = line.slice("* FROM CLIP NAME:".length).trim();
    } else {
      const m = EVENT_RE.exec(line);
      if (m) {
        if (pending) events.push(pending);
        pending = {
          num: Number(m[1]),
          reel: m[2],
          track: m[3],
          srcIn: m[4],
          srcOut: m[5],
          recIn: m[6],
          recOut: m[7],
        };
      }
    }
  }
  if (pending) events.push(pending);
  return { title, fcm, events };
}

describe("EDL round-trip", () => {
  it("preserves source frames for a single event at 30fps", () => {
    const events: EdlEvent[] = [
      {
        reel: "TAKE1",
        track: "V",
        sourceInFrame: 30,
        sourceOutFrame: 90,
        clipName: "intro_take_1",
      },
    ];
    const edl = buildEdl({ title: "test", frameRate: 30, events });
    const parsed = parseEdl(edl);
    expect(parsed.title).toBe("test");
    expect(parsed.fcm).toBe("NON-DROP FRAME");
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].srcIn).toBe(framesToTimecode(30, 30));
    expect(parsed.events[0].srcOut).toBe(framesToTimecode(90, 30));
    expect(parsed.events[0].recIn).toBe(framesToTimecode(0, 30));
    expect(parsed.events[0].recOut).toBe(framesToTimecode(60, 30));
    expect(parsed.events[0].clipName).toBe("intro_take_1");
  });

  it("places events contiguously on the record timeline", () => {
    const events: EdlEvent[] = [
      { reel: "A", track: "V", sourceInFrame: 0, sourceOutFrame: 100 },
      { reel: "B", track: "V", sourceInFrame: 200, sourceOutFrame: 350 },
      { reel: "A", track: "V", sourceInFrame: 500, sourceOutFrame: 600 },
    ];
    const edl = buildEdl({ title: "t", frameRate: 30, events });
    const parsed = parseEdl(edl);
    expect(parsed.events).toHaveLength(3);
    // recOut of N === recIn of N+1
    expect(parsed.events[0].recOut).toBe(parsed.events[1].recIn);
    expect(parsed.events[1].recOut).toBe(parsed.events[2].recIn);
    // record cursor totals match source-frame totals
    const totalSrc = events.reduce((sum, e) => sum + (e.sourceOutFrame - e.sourceInFrame), 0);
    expect(parsed.events.at(-1)?.recOut).toBe(framesToTimecode(totalSrc, 30));
  });

  it("emits 1-indexed monotonically increasing event numbers", () => {
    const events: EdlEvent[] = [];
    for (let i = 0; i < 5; i++) {
      events.push({
        reel: `R${i}`,
        track: "V",
        sourceInFrame: i * 100,
        sourceOutFrame: i * 100 + 50,
      });
    }
    const parsed = parseEdl(buildEdl({ title: "t", frameRate: 30, events }));
    expect(parsed.events.map((e) => e.num)).toEqual([1, 2, 3, 4, 5]);
  });

  it("truncates and pads reel names to 8 chars", () => {
    const edl = buildEdl({
      title: "t",
      frameRate: 30,
      events: [
        {
          reel: "WAY_TOO_LONG_REEL_NAME",
          track: "V",
          sourceInFrame: 0,
          sourceOutFrame: 100,
        },
        { reel: "A", track: "V", sourceInFrame: 0, sourceOutFrame: 100 },
      ],
    });
    const parsed = parseEdl(edl);
    expect(parsed.events[0].reel).toBe("WAY_TOO_");
    expect(parsed.events[1].reel).toBe("A       ");
  });

  it("preserves track type column", () => {
    const edl = buildEdl({
      title: "t",
      frameRate: 30,
      events: [
        { reel: "A", track: "V", sourceInFrame: 0, sourceOutFrame: 30 },
        { reel: "A", track: "A1", sourceInFrame: 0, sourceOutFrame: 30 },
        { reel: "A", track: "B", sourceInFrame: 0, sourceOutFrame: 30 },
      ],
    });
    const parsed = parseEdl(edl);
    expect(parsed.events[0].track).toBe("V    ");
    expect(parsed.events[1].track).toBe("A1   ");
    expect(parsed.events[2].track).toBe("B    ");
  });

  it("survives 24/25/29.97/30/60 frame rates without drift", () => {
    for (const fps of [24, 25, 29.97, 30, 60]) {
      const events: EdlEvent[] = [{ reel: "R", track: "V", sourceInFrame: 0, sourceOutFrame: 240 }];
      const parsed = parseEdl(buildEdl({ title: "t", frameRate: fps, events }));
      // Round-trip via framesToTimecode for the same fps must match.
      expect(parsed.events[0].srcOut).toBe(framesToTimecode(240, fps));
    }
  });

  it("attaches clip-name comments only to the events that have them", () => {
    const events: EdlEvent[] = [
      {
        reel: "A",
        track: "V",
        sourceInFrame: 0,
        sourceOutFrame: 100,
        clipName: "first",
      },
      { reel: "B", track: "V", sourceInFrame: 0, sourceOutFrame: 100 },
      {
        reel: "C",
        track: "V",
        sourceInFrame: 0,
        sourceOutFrame: 100,
        clipName: "third",
      },
    ];
    const parsed = parseEdl(buildEdl({ title: "t", frameRate: 30, events }));
    expect(parsed.events[0].clipName).toBe("first");
    expect(parsed.events[1].clipName).toBeUndefined();
    expect(parsed.events[2].clipName).toBe("third");
  });
});
