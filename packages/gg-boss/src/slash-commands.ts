import type { SlashCommandInfo } from "@abukhaled/ogcoder/ui";

/**
 * Slash commands the boss CLI recognizes. Shape matches ggcoder's
 * SlashCommandInfo so the existing SlashCommandMenu in InputArea renders them.
 *
 * The actual handlers live in BossApp's handleSubmit — we just declare the
 * surface here so the menu is in one place.
 */
export const BOSS_SLASH_COMMANDS: SlashCommandInfo[] = [
  { name: "help", aliases: ["?"], description: "Show available commands" },
  { name: "model-boss", aliases: [], description: "Switch the orchestrator's model" },
  { name: "model-workers", aliases: [], description: "Switch every worker's model" },
  { name: "compact", aliases: [], description: "Compact the boss's context now" },
  { name: "tasks", aliases: ["t"], description: "Open the Tasks overlay (Ctrl+T)" },
  { name: "new", aliases: ["n"], description: "Start a fresh boss session" },
  { name: "clear", aliases: [], description: "Clear chat history (workers untouched)" },
  { name: "workers", aliases: ["w"], description: "List linked workers and their status" },
  { name: "quit", aliases: ["q", "exit"], description: "Exit gg-boss" },
];

export function isSlashCommand(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

export interface ParsedSlashCommand {
  name: string;
  args: string;
}

export function parseSlash(value: string): ParsedSlashCommand | null {
  if (!isSlashCommand(value)) return null;
  const rest = value.slice(1).trim();
  if (!rest) return null;
  const space = rest.indexOf(" ");
  if (space === -1) return { name: rest.toLowerCase(), args: "" };
  return { name: rest.slice(0, space).toLowerCase(), args: rest.slice(space + 1).trim() };
}

/** Resolve aliases to the canonical command name. */
export function canonicalName(name: string): string | null {
  for (const cmd of BOSS_SLASH_COMMANDS) {
    if (cmd.name === name) return cmd.name;
    if (cmd.aliases.includes(name)) return cmd.name;
  }
  return null;
}

export function buildHelpText(): string {
  const lines: string[] = ["**gg-boss commands**", ""];
  for (const cmd of BOSS_SLASH_COMMANDS) {
    const aliases =
      cmd.aliases.length > 0 ? ` (${cmd.aliases.map((a) => "/" + a).join(", ")})` : "";
    lines.push(`- \`/${cmd.name}\`${aliases} — ${cmd.description}`);
  }
  lines.push("");
  lines.push("**Keys**");
  lines.push("- `Esc` — interrupt the boss while it's running");
  lines.push("- `Ctrl+C` (twice) — exit");
  return lines.join("\n");
}
