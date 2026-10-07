// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEntranceLifetime,
  enterTranscriptRow,
  dissolveInAbove,
  teleport,
} from "./transcript-motion";

interface FakeAnimation {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  onfinish: (() => void) | null;
  cancel: ReturnType<typeof vi.fn>;
}

function stubAnimate(el: Element): FakeAnimation[] {
  const made: FakeAnimation[] = [];
  el.animate = vi.fn((keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
    const anim: FakeAnimation = { keyframes, options, onfinish: null, cancel: vi.fn() };
    made.push(anim);
    return anim as unknown as Animation;
  }) as unknown as Element["animate"];
  return made;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("entrance lifetime", () => {
  it("consumes before playback and never replays cancelled or paged rows", () => {
    const lifetime = createEntranceLifetime(10);
    expect(lifetime.consume(9)).toBe(false);
    expect(lifetime.consume(10)).toBe(true);
    expect(lifetime.consume(10)).toBe(false);
    lifetime.settle(14); // messages committed while chat is hidden
    expect(lifetime.consume(12)).toBe(false);
    expect(lifetime.consume(14)).toBe(false);
    expect(lifetime.consume(15)).toBe(true);
    expect(createEntranceLifetime(100).consume(100)).toBe(true);
  });

  it("uses opacity alone and cancels on deactivation", () => {
    const row = document.createElement("div");
    const animations = stubAnimate(row);
    const cancel = enterTranscriptRow(row);
    expect(animations[0]?.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    cancel();
    expect(animations[0]?.cancel).toHaveBeenCalledOnce();
  });
});

describe("teleport", () => {
  it("lands only once the transcript has dissolved out, then dissolves back in", () => {
    const scroller = document.createElement("div");
    const anims = stubAnimate(scroller);
    const land = vi.fn();

    teleport(scroller, land);
    expect(land).not.toHaveBeenCalled();
    expect(anims).toHaveLength(1);

    anims[0]?.onfinish?.();
    expect(land).toHaveBeenCalledTimes(1);
    expect(anims).toHaveLength(2);
    expect(anims[1]?.keyframes[1]).toMatchObject({ opacity: 1 });
  });

  it("never holds a frame, so finished animations leave the timeline", () => {
    const scroller = document.createElement("div");
    const anims = stubAnimate(scroller);
    teleport(scroller, vi.fn());
    anims[0]?.onfinish?.();
    for (const anim of anims) expect(anim.options.fill).toBeUndefined();
  });

  it("cancels without landing when a newer jump takes over", () => {
    const scroller = document.createElement("div");
    const anims = stubAnimate(scroller);
    const land = vi.fn();
    const cancel = teleport(scroller, land);
    cancel();
    expect(anims[0]?.cancel).toHaveBeenCalled();
    expect(land).not.toHaveBeenCalled();
  });

  it("just lands under reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }) as MediaQueryList);
    const scroller = document.createElement("div");
    const anims = stubAnimate(scroller);
    const land = vi.fn();
    teleport(scroller, land);
    expect(land).toHaveBeenCalledTimes(1);
    expect(anims).toHaveLength(0);
  });
});

describe("dissolveInAbove", () => {
  it("animates only the rows mounted above the previous first row", () => {
    const scroller = document.createElement("div");
    const older = [document.createElement("div"), document.createElement("div")];
    const previousFirst = document.createElement("div");
    scroller.append(...older, previousFirst);
    document.body.appendChild(scroller);
    const olderAnims = older.map(stubAnimate);
    const firstAnims = stubAnimate(previousFirst);

    dissolveInAbove(scroller, previousFirst);

    for (const anims of olderAnims) {
      expect(anims).toHaveLength(1);
      expect(anims[0]?.options.fill).toBeUndefined();
    }
    expect(firstAnims).toHaveLength(0);
  });
});
