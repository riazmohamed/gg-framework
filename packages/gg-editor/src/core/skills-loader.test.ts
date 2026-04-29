import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BundledSkill } from "../skills.js";
import { discoverSkills, extractDescription } from "./skills-loader.js";

const BUNDLED: BundledSkill[] = [
  { name: "alpha", description: "bundled alpha", content: "# alpha\nbundled body" },
  { name: "beta", description: "bundled beta", content: "# beta\nbundled body" },
];

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("extractDescription", () => {
  it("returns the first non-heading paragraph", () => {
    const md = "# title\n\nFirst real line.\nSecond.";
    expect(extractDescription(md)).toBe("First real line.");
  });
  it("falls back when only headings", () => {
    expect(extractDescription("# only\n## headings")).toBe("(no description)");
  });
  it("truncates at 200 chars", () => {
    const long = "x".repeat(300);
    const r = extractDescription(`# t\n\n${long}`);
    expect(r.length).toBe(200);
    expect(r.endsWith("…")).toBe(true);
  });
});

describe("discoverSkills", () => {
  it("returns bundled-only when no dirs exist", () => {
    const cwd = tmp("gg-skills-cwd-");
    const home = tmp("gg-skills-home-");
    const r = discoverSkills({ cwd, homeDir: home, bundled: BUNDLED });
    expect(r.map((s) => s.name).sort()).toEqual(["alpha", "beta"]);
    expect(r.every((s) => s.origin === "bundled")).toBe(true);
  });

  it("loads project skills with extracted description", () => {
    const cwd = tmp("gg-skills-cwd-");
    const home = tmp("gg-skills-home-");
    mkdirSync(join(cwd, ".gg/editor-skills"), { recursive: true });
    writeFileSync(join(cwd, ".gg/editor-skills/gamma.md"), "# gamma\n\nProject-only skill body.\n");
    const r = discoverSkills({ cwd, homeDir: home, bundled: BUNDLED });
    const gamma = r.find((s) => s.name === "gamma");
    expect(gamma?.origin).toBe("project");
    expect(gamma?.description).toBe("Project-only skill body.");
  });

  it("user skill overrides bundled (last-wins)", () => {
    const cwd = tmp("gg-skills-cwd-");
    const home = tmp("gg-skills-home-");
    mkdirSync(join(home, ".gg/editor-skills"), { recursive: true });
    writeFileSync(join(home, ".gg/editor-skills/alpha.md"), "# alpha\n\nUser-overridden alpha.\n");
    const r = discoverSkills({ cwd, homeDir: home, bundled: BUNDLED });
    const alpha = r.find((s) => s.name === "alpha");
    expect(alpha?.origin).toBe("user");
    expect(alpha?.description).toBe("User-overridden alpha.");
  });

  it("user wins over project when both define the same name", () => {
    const cwd = tmp("gg-skills-cwd-");
    const home = tmp("gg-skills-home-");
    mkdirSync(join(cwd, ".gg/editor-skills"), { recursive: true });
    mkdirSync(join(home, ".gg/editor-skills"), { recursive: true });
    writeFileSync(join(cwd, ".gg/editor-skills/alpha.md"), "# a\n\nfrom project\n");
    writeFileSync(join(home, ".gg/editor-skills/alpha.md"), "# a\n\nfrom user\n");
    const r = discoverSkills({ cwd, homeDir: home, bundled: BUNDLED });
    const alpha = r.find((s) => s.name === "alpha");
    expect(alpha?.origin).toBe("user");
  });
});
