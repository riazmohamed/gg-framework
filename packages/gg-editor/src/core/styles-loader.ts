import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve as resolvePath } from "node:path";

/**
 * Style presets — persistent user prefs about voice, format, defaults.
 *
 * Different from skills:
 *   - Skills are read on-demand via `read_skill` ("when X happens, do Y").
 *   - Styles are ALWAYS-ON. Their content folds into the system prompt as a
 *     "Active style" section so every reply respects the user's standing prefs.
 *
 * Layout (last wins on name collisions):
 *   <cwd>/.gg/editor-styles/*.md  (project)
 *   ~/.gg/editor-styles/*.md      (user)
 *
 * Project overrides user — opposite of skills (where user overrides project).
 * The reasoning: a project's checked-in style is the one the team agreed on;
 * a user's home preset is a default that defers to project conventions.
 */

export interface StyleSource {
  name: string;
  content: string;
  origin: "project" | "user";
  path: string;
}

export interface DiscoverStylesOptions {
  cwd: string;
  homeDir?: string;
}

export function discoverStyles(opts: DiscoverStylesOptions): StyleSource[] {
  const home = opts.homeDir ?? homedir();
  const projectDir = resolvePath(opts.cwd, ".gg/editor-styles");
  const userDir = resolvePath(home, ".gg/editor-styles");

  const user = readStyleDir(userDir, "user");
  const project = readStyleDir(projectDir, "project");

  // Project last so it overrides user (reverse of skills).
  const byName = new Map<string, StyleSource>();
  for (const s of [...user, ...project]) byName.set(s.name, s);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function readStyleDir(dir: string, origin: "project" | "user"): StyleSource[] {
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: StyleSource[] = [];
  for (const e of entries) {
    if (!e.endsWith(".md")) continue;
    const path = join(dir, e);
    try {
      const st = statSync(path);
      if (!st.isFile()) continue;
      const content = readFileSync(path, "utf8").trim();
      if (!content) continue;
      out.push({ name: basename(e, ".md"), content, origin, path });
    } catch {
      // skip unreadable
    }
  }
  return out;
}

/**
 * Render the active styles as a single markdown block to be embedded in the
 * system prompt. Returns "" when no styles are active.
 */
export function renderStylesBlock(styles: StyleSource[]): string {
  if (styles.length === 0) return "";
  const lines: string[] = [
    "",
    "# Active style presets",
    "",
    "These persistent user prefs apply to EVERY decision in this session. " +
      "Honour them unless explicitly overridden by the user.",
    "",
  ];
  for (const s of styles) {
    const tag = s.origin === "project" ? "_(project)_" : "_(user)_";
    lines.push(`## ${s.name} ${tag}`, "", s.content, "");
  }
  return lines.join("\n");
}
