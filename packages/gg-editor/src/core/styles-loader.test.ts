import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverStyles, renderStylesBlock } from "./styles-loader.js";

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("discoverStyles", () => {
  it("returns empty when neither dir exists", () => {
    const cwd = tmp("gg-styles-cwd-");
    const home = tmp("gg-styles-home-");
    expect(discoverStyles({ cwd, homeDir: home })).toEqual([]);
  });

  it("loads project + user styles", () => {
    const cwd = tmp("gg-styles-cwd-");
    const home = tmp("gg-styles-home-");
    mkdirSync(join(cwd, ".gg/editor-styles"), { recursive: true });
    mkdirSync(join(home, ".gg/editor-styles"), { recursive: true });
    writeFileSync(join(cwd, ".gg/editor-styles/voice.md"), "# voice\nproject voice");
    writeFileSync(join(home, ".gg/editor-styles/format.md"), "# format\nuser format");
    const r = discoverStyles({ cwd, homeDir: home });
    expect(r.map((s) => s.name).sort()).toEqual(["format", "voice"]);
    expect(r.find((s) => s.name === "voice")?.origin).toBe("project");
    expect(r.find((s) => s.name === "format")?.origin).toBe("user");
  });

  it("project overrides user on name collision (opposite of skills)", () => {
    const cwd = tmp("gg-styles-cwd-");
    const home = tmp("gg-styles-home-");
    mkdirSync(join(cwd, ".gg/editor-styles"), { recursive: true });
    mkdirSync(join(home, ".gg/editor-styles"), { recursive: true });
    writeFileSync(join(cwd, ".gg/editor-styles/x.md"), "project");
    writeFileSync(join(home, ".gg/editor-styles/x.md"), "user");
    const r = discoverStyles({ cwd, homeDir: home });
    expect(r).toHaveLength(1);
    expect(r[0].origin).toBe("project");
  });

  it("skips empty files", () => {
    const cwd = tmp("gg-styles-cwd-");
    const home = tmp("gg-styles-home-");
    mkdirSync(join(home, ".gg/editor-styles"), { recursive: true });
    writeFileSync(join(home, ".gg/editor-styles/empty.md"), "   \n  \n");
    expect(discoverStyles({ cwd, homeDir: home })).toEqual([]);
  });
});

describe("renderStylesBlock", () => {
  it("returns empty string when no styles", () => {
    expect(renderStylesBlock([])).toBe("");
  });

  it("renders one block per style with origin tag", () => {
    const out = renderStylesBlock([
      {
        name: "voice",
        content: "Be terse.",
        origin: "project",
        path: "/x/voice.md",
      },
      {
        name: "format",
        content: "Use bullet lists.",
        origin: "user",
        path: "/y/format.md",
      },
    ]);
    expect(out).toContain("# Active style presets");
    expect(out).toContain("## voice _(project)_");
    expect(out).toContain("Be terse.");
    expect(out).toContain("## format _(user)_");
    expect(out).toContain("Use bullet lists.");
  });
});
