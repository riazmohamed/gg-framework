import fs from "node:fs/promises";
import path from "node:path";
import { getAppPaths } from "../config.js";
import { parseSkillFile } from "./skills.js";

export interface CustomCommand {
  name: string;
  description: string;
  prompt: string;
  filePath: string;
  source: "global" | "project";
}

/**
 * Load custom slash commands from {cwd}/.gg/commands/*.md (project) and
 * ~/.gg/commands/*.md (global). Each .md file becomes a slash command.
 * Frontmatter provides name/description, and the body becomes the prompt
 * injected into the agent. Project-local commands win on a name collision
 * (same convention as agents and skills).
 */
export async function loadCustomCommands(cwd: string): Promise<CustomCommand[]> {
  const projectCmds = await loadCommandsFromDir(path.join(cwd, ".gg", "commands"), "project");
  const globalCmds = await loadCommandsFromDir(getAppPaths().commandsDir, "global");

  const commands = [...projectCmds];
  const seen = new Set(projectCmds.map((c) => c.name.toLowerCase()));
  for (const cmd of globalCmds) {
    if (seen.has(cmd.name.toLowerCase())) continue;
    seen.add(cmd.name.toLowerCase());
    commands.push(cmd);
  }
  return commands;
}

async function loadCommandsFromDir(
  dir: string,
  source: "global" | "project",
): Promise<CustomCommand[]> {
  const commands: CustomCommand[] = [];

  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return commands;
  }

  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const filePath = path.join(dir, file);

    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const parsed = parseSkillFile(raw, source);
      const name = parsed.name || path.basename(file, ".md");
      commands.push({
        name,
        description:
          parsed.description ||
          `Custom command from ${source === "global" ? "~/.gg" : ".gg"}/commands/${file}`,
        prompt: parsed.content,
        filePath,
        source,
      });
    } catch {
      // Skip unreadable files
    }
  }

  return commands;
}

/**
 * Custom commands from every workspace root: the project first, then each
 * folder added to it (`/add-dir`, a goal's attached repos). A name already
 * taken by an earlier root is skipped, so the project's own command wins.
 */
export async function loadWorkspaceCustomCommands(
  roots: readonly string[],
): Promise<CustomCommand[]> {
  const perRoot = await Promise.all(roots.map((root) => loadCustomCommands(root)));
  const seen = new Set<string>();
  const commands: CustomCommand[] = [];
  for (const command of perRoot.flat()) {
    if (seen.has(command.name)) continue;
    seen.add(command.name);
    commands.push(command);
  }
  return commands;
}
