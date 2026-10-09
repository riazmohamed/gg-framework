import os from "node:os";
import path from "node:path";
import type { Provider } from "@abukhaled/gg-ai";
import { describeDropped, importForeignSession } from "../core/foreign-session-import.js";
import { SessionManager } from "../core/session-manager.js";
import type { SlashCommand } from "../core/slash-commands.js";

const FORMAT_LABEL = { claude: "Claude Code", codex: "Codex", cursor: "Cursor" } as const;

export interface ImportDeps {
  sessionsDir?: string;
  cwd: () => string;
  provider: () => Provider;
  model: () => string;
}

/**
 * `/import <file>`: turn a Claude Code / Codex / Cursor transcript into a
 * resumable OG Coder session (the desktop picker's import, by path). The
 * current conversation is left alone; the result names the session to resume.
 */
export function createImportCommand(deps: ImportDeps): SlashCommand {
  return {
    name: "import",
    aliases: [],
    description: "Import a Claude Code, Codex or Cursor transcript as a session",
    usage: "/import <transcript.jsonl>",
    async execute(args) {
      const file = args.trim();
      if (!file) {
        return (
          "Usage: /import <transcript.jsonl>\n" +
          "Claude Code keeps them in ~/.claude/projects, Codex in ~/.codex/sessions. " +
          "`ogcoder sessions` lists this project's ones and imports on pick."
        );
      }
      if (!deps.sessionsDir) return "Sessions are not saved in this mode.";
      try {
        const imported = await importForeignSession({
          filePath: path.resolve(deps.cwd(), file.replace(/^~(?=[/\\]|$)/, os.homedir())),
          sessionManager: new SessionManager(deps.sessionsDir),
          provider: deps.provider(),
          model: deps.model(),
        });
        const dropped = describeDropped(imported.dropped);
        // `--resume <id>` looks in the current project's sessions, so a
        // transcript from another project needs its folder first.
        const here = path.resolve(imported.cwd) === path.resolve(deps.cwd());
        const resume = `ogcoder --resume ${imported.sessionId}`;
        return [
          `Imported ${imported.messageCount} messages from ${FORMAT_LABEL[imported.format]}` +
            (dropped === "nothing" ? "." : ` (dropped ${dropped}).`),
          `Resume it with: ${here ? resume : `cd ${JSON.stringify(imported.cwd)} && ${resume}`}`,
        ].join("\n");
      } catch (error) {
        return `Could not import: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}
