import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve as resolvePath } from "node:path";
import type { BundledSkill } from "../skills.js";

/**
 * User-extensible skill discovery.
 *
 * Priority (last wins on name collisions):
 *   bundled (compiled into the package)
 *   → project (<cwd>/.gg/editor-skills/*.md)
 *   → user    (~/.gg/editor-skills/*.md)
 *
 * Silent override is the intended behaviour. The system prompt's skill list
 * tags overridden entries so the agent (and the user) can see the layering.
 */

export interface SkillSource {
  name: string;
  description: string;
  content: string;
  origin: "bundled" | "project" | "user";
  /** Absolute path on disk (project / user only). */
  path?: string;
}

export interface DiscoverSkillsOptions {
  cwd: string;
  homeDir?: string;
  bundled: BundledSkill[];
}

export function discoverSkills(opts: DiscoverSkillsOptions): SkillSource[] {
  const home = opts.homeDir ?? homedir();
  const projectDir = resolvePath(opts.cwd, ".gg/editor-skills");
  const userDir = resolvePath(home, ".gg/editor-skills");

  const bundled: SkillSource[] = opts.bundled.map((s) => ({
    name: s.name,
    description: s.description,
    content: s.content,
    origin: "bundled" as const,
  }));

  const project = readSkillDir(projectDir, "project");
  const user = readSkillDir(userDir, "user");

  // last-wins by name across [bundled, project, user]
  const byName = new Map<string, SkillSource>();
  for (const s of [...bundled, ...project, ...user]) {
    byName.set(s.name, s);
  }
  return [...byName.values()];
}

function readSkillDir(dir: string, origin: "project" | "user"): SkillSource[] {
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: SkillSource[] = [];
  for (const e of entries) {
    if (!e.endsWith(".md")) continue;
    const path = join(dir, e);
    try {
      const st = statSync(path);
      if (!st.isFile()) continue;
      const content = readFileSync(path, "utf8");
      const name = basename(e, ".md");
      out.push({
        name,
        description: extractDescription(content),
        content,
        origin,
        path,
      });
    } catch {
      // skip unreadable files
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Extract a one-line description from a skill markdown.
 *
 * Strategy: the first non-empty, non-heading line of plain text. Truncated at
 * 200 chars. Falls back to "(no description)" if absent.
 */
export function extractDescription(content: string): string {
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (line.startsWith("---")) continue;
    if (line.startsWith("```")) continue;
    const out = line.length > 200 ? line.slice(0, 199) + "…" : line;
    return out;
  }
  return "(no description)";
}
