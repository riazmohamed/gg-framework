import fs from "node:fs/promises";
import path from "node:path";

export interface Skill {
  name: string;
  description: string;
  content: string;
  source: string;
}

/**
 * Discover skills from global and project-local skill directories.
 */
export async function discoverSkills(options: {
  globalSkillsDir: string;
  projectDir?: string;
}): Promise<Skill[]> {
  const skills: Skill[] = [];

  // Global skills: ~/.gg/skills/*.md
  const globalSkills = await loadSkillsFromDir(options.globalSkillsDir, "global");
  skills.push(...globalSkills);

  // Project skills: {cwd}/.gg/skills/*.md
  if (options.projectDir) {
    const projectSkillsDir = path.join(options.projectDir, ".gg", "skills");
    const projectSkills = await loadSkillsFromDir(projectSkillsDir, "project");
    skills.push(...projectSkills);
  }

  return skills;
}

async function loadSkillsFromDir(dir: string, source: string): Promise<Skill[]> {
  const skills: Skill[] = [];

  let dirents;
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return skills;
  }

  for (const entry of dirents) {
    const entryPath = path.join(dir, entry.name);

    // Flat layout: ~/.gg/skills/foo.md
    if (entry.isFile() && entry.name.endsWith(".md")) {
      try {
        const content = await fs.readFile(entryPath, "utf-8");
        const skill = parseSkillFile(content, source);
        if (!skill.name) skill.name = path.basename(entry.name, ".md");
        skills.push(skill);
      } catch {
        // Skip unreadable files
      }
      continue;
    }

    // Directory layout (skills.sh ecosystem): ~/.gg/skills/foo/SKILL.md
    if (entry.isDirectory()) {
      const skillFile = path.join(entryPath, "SKILL.md");
      try {
        const content = await fs.readFile(skillFile, "utf-8");
        const skill = parseSkillFile(content, source);
        if (!skill.name) skill.name = entry.name;
        skills.push(skill);
      } catch {
        // No SKILL.md — skip
      }
    }
  }

  return skills;
}

/**
 * Parse a skill file with optional frontmatter.
 * Supports simple key: value frontmatter between --- delimiters.
 */
export function parseSkillFile(raw: string, source: string): Skill {
  let name = "";
  let description = "";
  let content = raw;

  // Check for frontmatter
  if (raw.startsWith("---")) {
    const endIndex = raw.indexOf("---", 3);
    if (endIndex !== -1) {
      const frontmatter = raw.slice(3, endIndex).trim();
      content = raw.slice(endIndex + 3).trim();

      for (const line of frontmatter.split("\n")) {
        const colonIndex = line.indexOf(":");
        if (colonIndex === -1) continue;
        const key = line.slice(0, colonIndex).trim().toLowerCase();
        const value = line.slice(colonIndex + 1).trim();
        if (key === "name") name = value;
        else if (key === "description") description = value;
      }
    }
  }

  return { name, description, content, source };
}

/**
 * Format skills as a summary list for the system prompt.
 * Only includes names and descriptions — full content is loaded on-demand via the skill tool.
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const list = skills
    .map((s) => `- **${s.name}**${s.description ? `: ${s.description}` : ""}`)
    .join("\n");

  return (
    `## Skills\n\n` +
    `The following skills are available. Use the **skill** tool to invoke a skill when needed:\n\n` +
    list
  );
}
