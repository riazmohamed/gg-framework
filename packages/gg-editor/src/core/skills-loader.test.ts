import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BundledSkill } from "../skills.js";
import { discoverSkills, extractDescription, parseFrontmatter, stripFrontmatter } from "./skills-loader.js";

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

  it("reads YAML frontmatter for name + description", () => {
    const cwd = tmp("gg-skills-cwd-");
    const home = tmp("gg-skills-home-");
    mkdirSync(join(cwd, ".gg/editor-skills"), { recursive: true });
    const md = '---\nname: my-skill\ndescription: "Use when X happens."\n---\n\n# My Skill\n\nBody.\n';
    writeFileSync(join(cwd, ".gg/editor-skills/anything.md"), md);
    const r = discoverSkills({ cwd, homeDir: home, bundled: BUNDLED });
    const s = r.find((s) => s.name === "my-skill");
    expect(s).toBeTruthy();
    expect(s?.description).toBe("Use when X happens.");
    // Content retains the frontmatter as authored — read_skill returns the
    // full file so the agent can see metadata if it cares to.
    expect(s?.content.startsWith("---\nname:")).toBe(true);
  });

  it("frontmatter falls back to filename + body extraction when keys missing", () => {
    const cwd = tmp("gg-skills-cwd-");
    const home = tmp("gg-skills-home-");
    mkdirSync(join(cwd, ".gg/editor-skills"), { recursive: true });
    writeFileSync(join(cwd, ".gg/editor-skills/foo.md"), "---\nother: stuff\n---\n\nA body line.\n");
    const r = discoverSkills({ cwd, homeDir: home, bundled: BUNDLED });
    const s = r.find((s) => s.name === "foo");
    expect(s?.description).toBe("A body line.");
  });

  it("loads bundle-layout skill (<name>/SKILL.md)", () => {
    const cwd = tmp("gg-skills-cwd-");
    const home = tmp("gg-skills-home-");
    mkdirSync(join(cwd, ".gg/editor-skills/bundled-name"), { recursive: true });
    writeFileSync(
      join(cwd, ".gg/editor-skills/bundled-name/SKILL.md"),
      "---\nname: real-name\ndescription: From SKILL.md\n---\n\nBody.\n",
    );
    const r = discoverSkills({ cwd, homeDir: home, bundled: BUNDLED });
    const s = r.find((s) => s.name === "real-name");
    expect(s?.origin).toBe("project");
    expect(s?.description).toBe("From SKILL.md");
    expect(s?.path?.endsWith("SKILL.md")).toBe(true);
  });

  it("discovers from .gg/skills/ as well as legacy .gg/editor-skills/", () => {
    const cwd = tmp("gg-skills-cwd-");
    const home = tmp("gg-skills-home-");
    mkdirSync(join(cwd, ".gg/skills"), { recursive: true });
    writeFileSync(
      join(cwd, ".gg/skills/ecosystem.md"),
      "---\nname: ecosystem\ndescription: skills.sh format\n---\nBody\n",
    );
    const r = discoverSkills({ cwd, homeDir: home, bundled: BUNDLED });
    expect(r.find((s) => s.name === "ecosystem")?.origin).toBe("project");
  });
});

describe("parseFrontmatter / stripFrontmatter", () => {
  it("empty frontmatter when no leading ---", () => {
    expect(parseFrontmatter("# heading\n\nbody")).toEqual({});
  });

  it("unterminated frontmatter is ignored", () => {
    expect(parseFrontmatter("---\nname: x\n")).toEqual({});
  });

  it("strips quotes around values", () => {
    const fm = parseFrontmatter('---\nname: "with: colon"\ndescription: \'single\'\n---\n');
    expect(fm.name).toBe("with: colon");
    expect(fm.description).toBe("single");
  });

  it("stripFrontmatter removes the block + leading newline", () => {
    const md = "---\nname: x\n---\n# heading\n";
    expect(stripFrontmatter(md)).toBe("# heading\n");
  });

  it("stripFrontmatter is a no-op when no frontmatter", () => {
    expect(stripFrontmatter("# h\n")).toBe("# h\n");
  });
});
