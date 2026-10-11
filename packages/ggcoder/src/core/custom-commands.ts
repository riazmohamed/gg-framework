import fs from "node:fs/promises";
import path from "node:path";
import { getAppPaths } from "../config.js";
import { parseSkillFile } from "./skills.js";

export interface CustomCommand {
  name: string;
  description: string;
  prompt: string;
  filePath: string;
}

/**
 * Load custom slash commands from the global `~/.gg/commands/*.md` and the
 * project's `{cwd}/.gg/commands/*.md`. Each .md file becomes a slash command.
 * Frontmatter provides name/description, and the body becomes the prompt
 * injected into the agent. A project command overrides a global one with the
 * same name, matching how skills and agents merge.
 */
export async function loadCustomCommands(
  cwd: string,
  globalCommandsDir: string = path.join(getAppPaths().agentDir, "commands"),
): Promise<CustomCommand[]> {
  const byName = new Map<string, CustomCommand>();
  const projectDir = path.join(cwd, ".gg", "commands");
  for (const dir of [globalCommandsDir, projectDir]) {
    for (const command of await loadCommandsFromDir(dir)) byName.set(command.name, command);
  }
  return [...byName.values()];
}

async function loadCommandsFromDir(commandsDir: string): Promise<CustomCommand[]> {
  const commands: CustomCommand[] = [];

  let files: string[];
  try {
    files = await fs.readdir(commandsDir);
  } catch {
    return commands;
  }

  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const filePath = path.join(commandsDir, file);

    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const parsed = parseSkillFile(raw, "project");
      const name = parsed.name || path.basename(file, ".md");
      commands.push({
        name,
        description: parsed.description || `Custom command from ${file}`,
        prompt: parsed.content,
        filePath,
      });
    } catch {
      // Skip unreadable files
    }
  }

  return commands;
}
