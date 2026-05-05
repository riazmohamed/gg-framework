import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRAND_KIT_PATH, loadBrandKit, validateBrandKit, type BrandKit } from "./brand-kit.js";

function makeCwd(brand?: string): string {
  const cwd = mkdtempSync(join(tmpdir(), "gg-brandkit-test-"));
  if (brand !== undefined) {
    mkdirSync(join(cwd, ".gg"), { recursive: true });
    writeFileSync(join(cwd, BRAND_KIT_PATH), brand, "utf8");
  }
  return cwd;
}

describe("loadBrandKit", () => {
  it("returns null when no brand.json exists", () => {
    const cwd = makeCwd();
    expect(loadBrandKit(cwd)).toBeNull();
  });

  it("returns null on malformed JSON (no throw)", () => {
    const cwd = makeCwd("{ not valid json");
    expect(loadBrandKit(cwd)).toBeNull();
  });

  it("returns null on non-object root (array, primitive)", () => {
    expect(loadBrandKit(makeCwd('["a", "b"]'))).toBeNull();
    expect(loadBrandKit(makeCwd('"string"'))).toBeNull();
    expect(loadBrandKit(makeCwd("42"))).toBeNull();
  });

  it("parses a valid brand kit", () => {
    const cwd = makeCwd(
      JSON.stringify({
        channelName: "Ken Kai",
        logo: "assets/logo.png",
        fonts: { heading: "Bebas Neue", body: "Inter" },
        colors: { primary: "FF6B35", secondary: "004E89" },
        ctaText: "Subscribe for more",
      }),
    );
    const kit = loadBrandKit(cwd);
    expect(kit?.channelName).toBe("Ken Kai");
    expect(kit?.fonts?.heading).toBe("Bebas Neue");
    expect(kit?.colors?.primary).toBe("FF6B35");
  });
});

describe("validateBrandKit", () => {
  const noExist = () => false;

  it("ok=true on empty kit", () => {
    const v = validateBrandKit({}, "/tmp", noExist);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it("rejects malformed colors", () => {
    const kit: BrandKit = { colors: { primary: "#FF6B35", secondary: "no" } };
    const v = validateBrandKit(kit, "/tmp", noExist);
    expect(v.ok).toBe(false);
    expect(v.errors.find((e) => e.includes("colors.primary"))).toBeTruthy();
    expect(v.errors.find((e) => e.includes("colors.secondary"))).toBeTruthy();
  });

  it("rejects empty path strings", () => {
    const v = validateBrandKit({ logo: "" }, "/tmp", noExist);
    expect(v.ok).toBe(false);
    expect(v.errors.find((e) => e.includes("logo"))).toBeTruthy();
  });

  it("warns on missing referenced files", () => {
    const v = validateBrandKit({ logo: "missing.png" }, "/tmp", noExist);
    expect(v.ok).toBe(true);
    expect(v.warnings.find((w) => w.includes("logo"))).toBeTruthy();
  });

  it("no warning when fileExists returns true", () => {
    const v = validateBrandKit({ logo: "logo.png" }, "/tmp", () => true);
    expect(v.ok).toBe(true);
    expect(v.warnings).toEqual([]);
  });

  it("accepts six-char hex colors (no leading #)", () => {
    const v = validateBrandKit({ colors: { primary: "FFFFFF", accent: "00aaff" } }, "/tmp", noExist);
    expect(v.ok).toBe(true);
  });
});
