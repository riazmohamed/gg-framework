/**
 * Round-trip golden tests for the FCPXML emitter.
 *
 * Like the EDL counterpart: targeted regex extraction of asset-clip elements
 * + numeric verification of `start` / `duration` / `offset` attributes.
 *
 * These guard against silent drift in time-rational construction
 * (e.g. accidentally swapping num/den in 29.97 or 23.976 fractions).
 */
import { describe, expect, it } from "vitest";
import { buildFcpxml, type FcpxmlEvent } from "./fcpxml.js";

interface AssetClip {
  ref: string;
  name: string;
  offset: string;
  start?: string;
  duration: string;
}

function parseAssetClips(xml: string): AssetClip[] {
  const out: AssetClip[] = [];
  const re = /<asset-clip\b([^>]*)\/?>/g;
  for (const m of xml.matchAll(re)) {
    const attrs = m[1];
    const ref = /ref="([^"]+)"/.exec(attrs)?.[1] ?? "";
    const name = /name="([^"]+)"/.exec(attrs)?.[1] ?? "";
    const offset = /offset="([^"]+)"/.exec(attrs)?.[1] ?? "";
    const start = /start="([^"]+)"/.exec(attrs)?.[1];
    const duration = /duration="([^"]+)"/.exec(attrs)?.[1] ?? "";
    out.push({ ref, name, offset, start, duration });
  }
  return out;
}

function parseAssets(xml: string): Array<{ id: string; src: string; hasAudio: string }> {
  const out: Array<{ id: string; src: string; hasAudio: string }> = [];
  // <asset ...> but not <asset-clip ...>
  const re = /<asset(?![-\w])([^>]*?)\/?>/g;
  for (const m of xml.matchAll(re)) {
    const attrs = m[1];
    const id = /id="([^"]+)"/.exec(attrs)?.[1] ?? "";
    const src = /src="([^"]+)"/.exec(attrs)?.[1] ?? "";
    const hasAudio = /hasAudio="([^"]+)"/.exec(attrs)?.[1] ?? "";
    out.push({ id, src, hasAudio });
  }
  return out;
}

/** Parse "Ns" or "N/Ds" into a number of seconds. */
function timeToSec(t: string): number {
  if (t === "0s" || t === "0") return 0;
  const m = /^([0-9]+)(?:\/([0-9]+))?s?$/.exec(t);
  if (!m) throw new Error(`unrecognised time literal: ${t}`);
  const num = Number(m[1]);
  const den = m[2] ? Number(m[2]) : 1;
  return num / den;
}

describe("FCPXML round-trip", () => {
  it("emits one asset per unique reel", () => {
    const events: FcpxmlEvent[] = [
      { reel: "A", sourcePath: "/a.mov", sourceInFrame: 0, sourceOutFrame: 60 },
      { reel: "B", sourcePath: "/b.mov", sourceInFrame: 0, sourceOutFrame: 60 },
      { reel: "A", sourcePath: "/a.mov", sourceInFrame: 200, sourceOutFrame: 250 },
    ];
    const xml = buildFcpxml({ title: "t", frameRate: 30, events });
    const assets = parseAssets(xml);
    expect(assets).toHaveLength(2);
    expect(assets.find((a) => a.src.endsWith("/a.mov"))).toBeDefined();
    expect(assets.find((a) => a.src.endsWith("/b.mov"))).toBeDefined();
  });

  it("places clips contiguously by offset (record timeline)", () => {
    const events: FcpxmlEvent[] = [
      { reel: "A", sourcePath: "/a.mov", sourceInFrame: 0, sourceOutFrame: 60 },
      { reel: "B", sourcePath: "/b.mov", sourceInFrame: 0, sourceOutFrame: 90 },
      { reel: "A", sourcePath: "/a.mov", sourceInFrame: 0, sourceOutFrame: 30 },
    ];
    const xml = buildFcpxml({ title: "t", frameRate: 30, events });
    const clips = parseAssetClips(xml);
    expect(clips).toHaveLength(3);
    // offsets: 0, 60/30=2s, (60+90)/30=5s
    expect(timeToSec(clips[0].offset)).toBeCloseTo(0);
    expect(timeToSec(clips[1].offset)).toBeCloseTo(2);
    expect(timeToSec(clips[2].offset)).toBeCloseTo(5);
  });

  it("durations come from sourceOut - sourceIn", () => {
    const events: FcpxmlEvent[] = [
      { reel: "A", sourcePath: "/a.mov", sourceInFrame: 30, sourceOutFrame: 90 },
    ];
    const xml = buildFcpxml({ title: "t", frameRate: 30, events });
    const clips = parseAssetClips(xml);
    expect(timeToSec(clips[0].duration)).toBeCloseTo(60 / 30);
  });

  it("uses NTSC fractions for 29.97 frame rate", () => {
    const events: FcpxmlEvent[] = [
      { reel: "A", sourcePath: "/a.mov", sourceInFrame: 0, sourceOutFrame: 30 },
    ];
    const xml = buildFcpxml({ title: "t", frameRate: 29.97, events });
    // 30 frames at 30000/1001 fps = 30 * 1001/30000 s = 1001/1000 s
    const clips = parseAssetClips(xml);
    // Ratio should approximate 1.001 seconds
    expect(timeToSec(clips[0].duration)).toBeCloseTo(1.001, 3);
  });

  it("uses NTSC fractions for 23.976 frame rate", () => {
    const events: FcpxmlEvent[] = [
      { reel: "A", sourcePath: "/a.mov", sourceInFrame: 0, sourceOutFrame: 24 },
    ];
    const xml = buildFcpxml({ title: "t", frameRate: 23.976, events });
    const clips = parseAssetClips(xml);
    // 24 frames at 24000/1001 = 24 * 1001/24000 s = 1.001s
    expect(timeToSec(clips[0].duration)).toBeCloseTo(1.001, 3);
  });

  it("each clip references a real asset id", () => {
    const events: FcpxmlEvent[] = [
      { reel: "X", sourcePath: "/x.mov", sourceInFrame: 0, sourceOutFrame: 30 },
      { reel: "Y", sourcePath: "/y.mov", sourceInFrame: 0, sourceOutFrame: 30 },
    ];
    const xml = buildFcpxml({ title: "t", frameRate: 30, events });
    const assets = parseAssets(xml);
    const clips = parseAssetClips(xml);
    const assetIds = new Set(assets.map((a) => a.id));
    for (const c of clips) {
      expect(assetIds.has(c.ref)).toBe(true);
    }
  });

  it("emits standard audio metadata on every asset (real-world Resolve/Premiere export shape)", () => {
    // Audio routing in Resolve / Premiere relies on hasAudio + audioSources +
    // audioChannels + audioRate. Real-world fixtures from BBC fcpx-xml-composer,
    // DozaVisuals, and the Apple FCPXML 1.10 sample all include these.
    const events: FcpxmlEvent[] = [
      { reel: "A", sourcePath: "/a.mov", sourceInFrame: 0, sourceOutFrame: 60 },
    ];
    const xml = buildFcpxml({ title: "t", frameRate: 30, events });
    expect(xml).toContain('hasVideo="1"');
    expect(xml).toContain('videoSources="1"');
    expect(xml).toContain('hasAudio="1"');
    expect(xml).toContain('audioSources="1"');
    expect(xml).toContain('audioChannels="2"');
    expect(xml).toContain('audioRate="48000"');
  });

  it("honours custom audioChannels / audioRate overrides", () => {
    const xml = buildFcpxml({
      title: "t",
      frameRate: 30,
      events: [{ reel: "A", sourcePath: "/a.mov", sourceInFrame: 0, sourceOutFrame: 30 }],
      audioChannels: 1,
      audioRate: 44100,
    });
    expect(xml).toContain('audioChannels="1"');
    expect(xml).toContain('audioRate="44100"');
  });

  it("preserves clip names when supplied", () => {
    const events: FcpxmlEvent[] = [
      {
        reel: "A",
        sourcePath: "/a.mov",
        sourceInFrame: 0,
        sourceOutFrame: 30,
        clipName: "intro_take_3",
      },
    ];
    const xml = buildFcpxml({ title: "t", frameRate: 30, events });
    const clips = parseAssetClips(xml);
    // FCPXML emitter appends a sequence index to the clip name to keep them
    // unique across the spine; check the prefix.
    expect(clips[0].name.startsWith("intro_take_3")).toBe(true);
  });
});

describe("FCPXML round-trip — transform / keyframes / lane / title", () => {
  it('emits both <adjust-transform> and <param name="position"> for a keyframed clip', () => {
    const events: FcpxmlEvent[] = [
      {
        reel: "A",
        sourcePath: "/a.mov",
        sourceInFrame: 0,
        sourceOutFrame: 60,
        transform: {
          position: {
            keyframes: [
              { frame: 0, value: [0, 0] },
              { frame: 60, value: [200, 0] },
            ],
          },
        },
      },
    ];
    const xml = buildFcpxml({ title: "t", frameRate: 30, events });
    expect(xml).toContain("<adjust-transform");
    expect(xml).toContain('<param name="position">');
    // Two keyframes, no interp on either (position rule).
    const kfs = [...xml.matchAll(/<keyframe time="([^"]+)" value="([^"]+)"\s*\/>/g)];
    expect(kfs.length).toBeGreaterThanOrEqual(2);
    // Position values should be the literal x y pairs we asked for.
    expect(kfs.find((m) => m[2] === "0 0")).toBeDefined();
    expect(kfs.find((m) => m[2] === "200 0")).toBeDefined();
  });

  it('emits <filter-audio>/<param name="gain"> with linear interp for volume ramps', () => {
    const events: FcpxmlEvent[] = [
      {
        reel: "A",
        sourcePath: "/a.mov",
        sourceInFrame: 0,
        sourceOutFrame: 60,
        volumeDb: {
          keyframes: [
            { frame: 0, value: -60 },
            { frame: 30, value: 0 },
            { frame: 60, value: -60 },
          ],
        },
      },
    ];
    const xml = buildFcpxml({ title: "t", frameRate: 30, events });
    expect(xml).toContain('<filter-audio name="Volume">');
    // Every gain keyframe carries interp (NOT skipped like position).
    const gainKfs = [
      ...xml.matchAll(/<keyframe time="[^"]+" value="-?\d+(\.\d+)?" interp="[^"]+" \/>/g),
    ];
    expect(gainKfs.length).toBeGreaterThanOrEqual(3);
  });

  it("places lane clips at absolute offsets without disturbing the spine cursor", () => {
    const events: FcpxmlEvent[] = [
      { reel: "A", sourcePath: "/a.mov", sourceInFrame: 0, sourceOutFrame: 90 },
      {
        reel: "B",
        sourcePath: "/b.mov",
        sourceInFrame: 0,
        sourceOutFrame: 30,
        lane: 1,
        recordOffsetFrame: 30,
      },
      { reel: "A", sourcePath: "/a.mov", sourceInFrame: 90, sourceOutFrame: 150 },
    ];
    const xml = buildFcpxml({ title: "t", frameRate: 30, events });
    const clips = parseAssetClips(xml);
    // 3 clips total; the spine clips advance the cursor (90 frames + 60 = 5s),
    // and the lane clip sits at 1s without touching the cursor.
    expect(clips).toHaveLength(3);
    const spineOffsets = clips.filter((_, i) => i !== 1).map((c) => timeToSec(c.offset));
    expect(spineOffsets[0]).toBeCloseTo(0);
    expect(spineOffsets[1]).toBeCloseTo(3); // 90/30
  });

  it("emits a Basic Title effect resource exactly once when multiple titles share it", () => {
    const xml = buildFcpxml({
      title: "t",
      frameRate: 30,
      events: [{ reel: "A", sourcePath: "/a.mov", sourceInFrame: 0, sourceOutFrame: 60 }],
      titles: [
        { text: "One", startFrame: 0, durationFrames: 30 },
        { text: "Two", startFrame: 30, durationFrames: 30 },
      ],
    });
    const titleEffectMatches = [...xml.matchAll(/name="Basic Title"/g)];
    // The resource is emitted once; the two <title> elements reference it.
    const titleElementMatches = [...xml.matchAll(/<title ref="/g)];
    expect(titleEffectMatches.length).toBe(1);
    expect(titleElementMatches.length).toBe(2);
  });
});
