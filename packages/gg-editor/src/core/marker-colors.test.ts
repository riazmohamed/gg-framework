import { describe, expect, it } from "vitest";
import { PremiereAdapter } from "./hosts/premiere/adapter.js";
import {
  PREMIERE_COLOR_INDEX,
  RESOLVE_MARKER_COLORS,
  RESOLVE_TO_PREMIERE_INDEX,
  toResolveColor,
} from "./marker-colors.js";

describe("RESOLVE_MARKER_COLORS", () => {
  it("matches the canonical 16-color set (samuelgursky/davinci-resolve-mcp)", () => {
    expect(RESOLVE_MARKER_COLORS).toEqual([
      "Blue",
      "Cyan",
      "Green",
      "Yellow",
      "Red",
      "Pink",
      "Purple",
      "Fuchsia",
      "Rose",
      "Lavender",
      "Sky",
      "Mint",
      "Lemon",
      "Sand",
      "Cocoa",
      "Cream",
    ]);
  });
});

describe("PREMIERE_COLOR_INDEX", () => {
  it("covers all 8 Premiere colorIndex values exactly once", () => {
    const values = Object.values(PREMIERE_COLOR_INDEX);
    const uniq = new Set(values);
    expect(uniq.size).toBe(8);
    expect(values.every((v) => v >= 0 && v <= 7)).toBe(true);
  });
});

describe("RESOLVE_TO_PREMIERE_INDEX", () => {
  it("maps every Resolve color to a valid Premiere index 0-7", () => {
    for (const c of RESOLVE_MARKER_COLORS) {
      const idx = RESOLVE_TO_PREMIERE_INDEX[c.toLowerCase()];
      expect(idx).toBeDefined();
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThanOrEqual(7);
    }
  });

  it("Resolve-only hues snap to nearest hue family", () => {
    expect(RESOLVE_TO_PREMIERE_INDEX.pink).toBe(1); // red family
    expect(RESOLVE_TO_PREMIERE_INDEX.fuchsia).toBe(2); // purple family
    expect(RESOLVE_TO_PREMIERE_INDEX.mint).toBe(0); // green family
    expect(RESOLVE_TO_PREMIERE_INDEX.lavender).toBe(2); // purple family
    expect(RESOLVE_TO_PREMIERE_INDEX.sky).toBe(7); // cyan family
    expect(RESOLVE_TO_PREMIERE_INDEX.cream).toBe(5); // white family
  });
});

describe("toResolveColor", () => {
  it("normalises lowercase to Title Case for known names", () => {
    expect(toResolveColor("blue")).toBe("Blue");
    expect(toResolveColor("PURPLE")).toBe("Purple");
    expect(toResolveColor("fuchsia")).toBe("Fuchsia");
  });
  it("Title-cases an unknown name without erroring (Resolve will reject downstream)", () => {
    expect(toResolveColor("indigo")).toBe("Indigo");
  });
});

describe("PremiereAdapter color snapping", () => {
  // Bug this fixes: Premiere JSX's _markerColor only knows 8 names. If the
  // agent passed a Resolve-only hue like "pink" or "mint", JSX fell back to
  // blue (index 6) instead of the closest hue family. Adapter now snaps
  // BEFORE the bridge call so the right color always lands.
  const snap = PremiereAdapter._snapColorToPremiereForTest;

  it("passes Premiere-native names unchanged", () => {
    expect(snap("red")).toBe("red");
    expect(snap("orange")).toBe("orange");
    expect(snap("white")).toBe("white");
  });

  it("snaps Resolve-only hues to closest Premiere family", () => {
    expect(snap("pink")).toBe("red");
    expect(snap("rose")).toBe("red");
    expect(snap("fuchsia")).toBe("purple");
    expect(snap("lavender")).toBe("purple");
    expect(snap("sky")).toBe("cyan");
    expect(snap("mint")).toBe("green");
    expect(snap("lemon")).toBe("yellow");
    expect(snap("sand")).toBe("yellow");
    expect(snap("cocoa")).toBe("red");
    expect(snap("cream")).toBe("white");
  });

  it("handles uppercase / mixed-case input", () => {
    expect(snap("PINK")).toBe("red");
    expect(snap("Mint")).toBe("green");
  });

  it("resolves numeric Premiere index to its name", () => {
    expect(snap(0)).toBe("green");
    expect(snap(6)).toBe("blue");
    expect(snap(7)).toBe("cyan");
  });

  it("defaults to blue for unknown / undefined / empty", () => {
    expect(snap(undefined)).toBe("blue");
    expect(snap("")).toBe("blue");
    expect(snap("   ")).toBe("blue");
    expect(snap("indigo")).toBe("blue"); // not in any map
    expect(snap(99)).toBe("blue"); // out-of-range index
  });
});

describe("PremiereAdapter transport → runtime mapping", () => {
  // The adapter advertises `runtime` in HostCapabilities so the agent can warn
  // users when they're on the CEP/ExtendScript sunset path (Sept 2026).
  const map = PremiereAdapter._mapTransportToRuntimeForTest;

  it("http-uxp → uxp (the only forward path)", () => {
    expect(map("http-uxp")).toBe("uxp");
  });

  it("http-cep → cep (deprecated, EOL Sept 2026)", () => {
    expect(map("http-cep")).toBe("cep");
  });

  it("osascript-cep → osascript (also EOL Sept 2026)", () => {
    expect(map("osascript-cep")).toBe("osascript");
  });
});
