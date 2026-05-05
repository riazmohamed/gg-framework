import { describe, expect, it } from "vitest";
import {
  buildRenderFilter,
  MULTI_FORMATS,
  multiFormatSpec,
  type MultiFormat,
} from "./multi-format.js";

describe("multiFormatSpec", () => {
  it("exposes seven canonical presets", () => {
    expect(MULTI_FORMATS).toEqual([
      "youtube-1080p",
      "shorts-9x16",
      "reels-9x16",
      "tiktok-9x16",
      "square-1x1",
      "instagram-4x5",
      "twitter-16x9",
    ]);
  });

  it("returns 1920x1080 for youtube-1080p (scale-pad)", () => {
    expect(multiFormatSpec("youtube-1080p")).toEqual({
      width: 1920,
      height: 1080,
      transform: "scale-pad",
    });
  });

  it("returns 1080x1920 + centre-crop for the three vertical aliases", () => {
    for (const f of ["shorts-9x16", "reels-9x16", "tiktok-9x16"] as const) {
      expect(multiFormatSpec(f)).toEqual({
        width: 1080,
        height: 1920,
        transform: "centre-crop",
      });
    }
  });

  it("returns 1080x1080 for square-1x1, 1080x1350 for instagram-4x5, 1280x720 for twitter-16x9", () => {
    expect(multiFormatSpec("square-1x1")).toMatchObject({ width: 1080, height: 1080 });
    expect(multiFormatSpec("instagram-4x5")).toMatchObject({ width: 1080, height: 1350 });
    expect(multiFormatSpec("twitter-16x9")).toMatchObject({
      width: 1280,
      height: 720,
      transform: "scale-pad",
    });
  });

  it("throws on unknown preset", () => {
    expect(() => multiFormatSpec("bogus" as MultiFormat)).toThrow(/unknown multi-format preset/);
  });
});

describe("buildRenderFilter — 1920x1080 source", () => {
  it("youtube-1080p: emits scale+pad to 1920x1080", () => {
    const r = buildRenderFilter(1920, 1080, "youtube-1080p");
    expect(r.transform).toBe("scale-pad");
    expect(r.targetW).toBe(1920);
    expect(r.targetH).toBe(1080);
    expect(r.vf).toBe(
      "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black",
    );
  });

  it("shorts-9x16 from 1920x1080: centre-crops width to 607.5, x=656.25", () => {
    const r = buildRenderFilter(1920, 1080, "shorts-9x16");
    expect(r.transform).toBe("centre-crop");
    expect(r.targetW).toBe(1080);
    expect(r.targetH).toBe(1920);
    expect(r.vf).toBe("crop=607.5:1080:656.25:0,scale=1080:1920");
  });

  it("square-1x1 from 1920x1080: crops width to 1080, x=420", () => {
    const r = buildRenderFilter(1920, 1080, "square-1x1");
    expect(r.transform).toBe("centre-crop");
    // 1080 * 1 / 1 = 1080 ; (1920 - 1080)/2 = 420
    expect(r.vf).toBe("crop=1080:1080:420:0,scale=1080:1080");
  });

  it("instagram-4x5 from 1920x1080: crops width to 864, x=528", () => {
    const r = buildRenderFilter(1920, 1080, "instagram-4x5");
    // 1080 * 4 / 5 = 864 ; (1920 - 864)/2 = 528
    expect(r.transform).toBe("centre-crop");
    expect(r.vf).toBe("crop=864:1080:528:0,scale=1080:1350");
  });

  it("twitter-16x9 from 1920x1080: scale+pad to 1280x720", () => {
    const r = buildRenderFilter(1920, 1080, "twitter-16x9");
    expect(r.transform).toBe("scale-pad");
    expect(r.targetW).toBe(1280);
    expect(r.targetH).toBe(720);
    expect(r.vf).toBe(
      "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black",
    );
  });
});

describe("buildRenderFilter — 3840x2160 source (4K UHD, also 16:9)", () => {
  it("shorts-9x16: same crop math scaled — cropW=1215, x=1312.5", () => {
    const r = buildRenderFilter(3840, 2160, "shorts-9x16");
    // 2160 * 9 / 16 = 1215 ; (3840 - 1215) / 2 = 1312.5
    expect(r.vf).toBe("crop=1215:2160:1312.5:0,scale=1080:1920");
  });

  it("youtube-1080p: scale-pad still emits the 1080p target", () => {
    const r = buildRenderFilter(3840, 2160, "youtube-1080p");
    expect(r.targetW).toBe(1920);
    expect(r.targetH).toBe(1080);
    expect(r.vf).toContain("scale=1920:1080:force_original_aspect_ratio=decrease");
  });

  it("instagram-4x5 from 4K: cropW=1728, x=1056", () => {
    const r = buildRenderFilter(3840, 2160, "instagram-4x5");
    // 2160 * 4 / 5 = 1728 ; (3840 - 1728) / 2 = 1056
    expect(r.vf).toBe("crop=1728:2160:1056:0,scale=1080:1350");
  });

  it("square-1x1 from 4K: cropW=2160, x=840", () => {
    const r = buildRenderFilter(3840, 2160, "square-1x1");
    expect(r.vf).toBe("crop=2160:2160:840:0,scale=1080:1080");
  });
});

describe("buildRenderFilter — 1080x1920 portrait source", () => {
  it("shorts-9x16: aspects match, no crop — just scale", () => {
    const r = buildRenderFilter(1080, 1920, "shorts-9x16");
    expect(r.transform).toBe("centre-crop");
    expect(r.vf).toBe("scale=1080:1920");
  });

  it("youtube-1080p: scale+pad pillarboxes the portrait into 1920x1080", () => {
    const r = buildRenderFilter(1080, 1920, "youtube-1080p");
    expect(r.transform).toBe("scale-pad");
    expect(r.vf).toBe(
      "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black",
    );
  });

  it("square-1x1 from portrait: src is taller than 1:1, so crop HEIGHT", () => {
    const r = buildRenderFilter(1080, 1920, "square-1x1");
    // srcAR = 1080/1920 = 0.5625 < 1 (target). crop height: cropH = iw*Ht/Wt = 1080*1/1 = 1080 ; y = (1920-1080)/2 = 420
    expect(r.vf).toBe("crop=1080:1080:0:420,scale=1080:1080");
  });

  it("instagram-4x5 from portrait: src AR (0.5625) < target AR (0.8) → crop height", () => {
    const r = buildRenderFilter(1080, 1920, "instagram-4x5");
    // cropH = iw * Ht/Wt = 1080 * 1350/1080 = 1350 ; y = (1920 - 1350)/2 = 285
    expect(r.vf).toBe("crop=1080:1350:0:285,scale=1080:1350");
  });
});

describe("buildRenderFilter — scale-pad math for upscale source 1280x720", () => {
  it("youtube-1080p target from 720p: scale up + pad to 1920x1080", () => {
    const r = buildRenderFilter(1280, 720, "youtube-1080p");
    expect(r.transform).toBe("scale-pad");
    expect(r.targetW).toBe(1920);
    expect(r.targetH).toBe(1080);
    expect(r.vf).toBe(
      "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black",
    );
  });
});

describe("buildRenderFilter — faceTracked option", () => {
  it("forces scale-pad for vertical presets when faceTracked=true", () => {
    const r = buildRenderFilter(1920, 1080, "shorts-9x16", { faceTracked: true });
    expect(r.transform).toBe("scale-pad");
    expect(r.vf).toBe(
      "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black",
    );
  });

  it("is a no-op for already-scale-pad presets", () => {
    const a = buildRenderFilter(1920, 1080, "youtube-1080p", { faceTracked: true });
    const b = buildRenderFilter(1920, 1080, "youtube-1080p", { faceTracked: false });
    expect(a.vf).toBe(b.vf);
  });
});

describe("buildRenderFilter — input validation", () => {
  it("rejects zero / negative / non-finite dimensions", () => {
    expect(() => buildRenderFilter(0, 1080, "youtube-1080p")).toThrow(/invalid source dimensions/);
    expect(() => buildRenderFilter(1920, -1, "youtube-1080p")).toThrow(/invalid source dimensions/);
    expect(() => buildRenderFilter(NaN, 1080, "youtube-1080p")).toThrow(
      /invalid source dimensions/,
    );
  });
});
