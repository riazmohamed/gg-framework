import {
  SlashCommandRegistry,
  createBuiltinCommands,
  type SlashCommand,
} from "../core/slash-commands.js";
import type { PromptCommand } from "../core/prompt-commands.js";
import type { CustomCommand } from "../core/custom-commands.js";

/**
 * Registry commands the terminal app does NOT take from the shared registry:
 * App.tsx handles these itself (they need React state — the model picker, the
 * checkpoint picker, the exit summary), and `/branch(es)` are covered by the
 * TUI's `/rewind`, which also restores files. `/model <id>` switches through the
 * same handler as the picker, so it reports the switch once. `help` is replaced by
 * {@link formatTuiHelp}, which knows the TUI-only commands and shortcuts.
 */
const TUI_HANDLED = new Set(["model", "compact", "quit", "rewind", "branch", "branches", "help"]);

/** Commands the TUI handles in App.tsx, listed for /help. */
export const TUI_UI_COMMANDS: ReadonlyArray<{ usage: string; description: string }> = [
  {
    usage: "/model",
    description: "Open the model picker (/model provider:model switches directly)",
  },
  {
    usage: "/compact [focus]",
    description: "Compact the conversation, keeping what the focus names",
  },
  { usage: "/clear", description: "Clear the session and start fresh" },
  { usage: "/rewind", description: "Restore files and/or conversation to a checkpoint" },
  { usage: "/theme", description: "Switch theme" },
  { usage: "/markdown", description: "Toggle rendered / raw markdown" },
  { usage: "/clearplan", description: "Dismiss the approved plan" },
  { usage: "/ideal-on, /ideal-off", description: "Enable / disable loop-break nudges" },
  { usage: "/help", description: "Show this list" },
  { usage: "/quit", description: "Exit with a session summary" },
];

export const TUI_SHORTCUTS: ReadonlyArray<[string, string]> = [
  ["Enter / Shift+Enter", "Send / new line"],
  ["Esc, Ctrl+C", "Stop the running turn (Esc twice clears the input)"],
  ["Shift+Tab", "Cycle thinking level"],
  ["Ctrl+T", "Tasks"],
  ["Ctrl+S", "Skills"],
  ["Ctrl+M", "Toggle markdown rendering"],
  ["Ctrl+R", "Search prompt history"],
  ["Ctrl+V", "Paste (images too)"],
  ["Tab", "Complete a slash command"],
  ["Shift+Up/Down, g, G", "Scroll the transcript"],
  ["Ctrl+A/E/K/U/W/Y", "Readline-style editing"],
];

/** The shared registry, minus the commands the TUI owns itself. */
export function createTuiSlashRegistry(extra: SlashCommand[] = []): SlashCommandRegistry {
  const registry = new SlashCommandRegistry();
  for (const command of [...createBuiltinCommands(), ...extra]) {
    if (!TUI_HANDLED.has(command.name)) registry.register(command);
  }
  return registry;
}

/** True when `input` names a command in `registry` (by name or alias). */
export function isRegistryCommand(registry: SlashCommandRegistry, input: string): boolean {
  const parsed = registry.parse(input);
  return parsed !== null && registry.get(parsed.name) !== undefined;
}

/** The TUI's `/help`: every reachable command plus the keyboard shortcuts. */
export function formatTuiHelp(
  registry: SlashCommandRegistry,
  promptCommands: readonly PromptCommand[],
  customCommands: readonly CustomCommand[],
): string {
  const row = (left: string, right: string) => {
    // One line per command: long custom-command descriptions otherwise wrap.
    const text = right.length > 90 ? `${right.slice(0, 89).trimEnd()}…` : right;
    return `  ${left.padEnd(26)} ${text}`;
  };
  const lines = ["Commands", ...TUI_UI_COMMANDS.map((c) => row(c.usage, c.description))];
  for (const command of registry.getAll()) lines.push(row(command.usage, command.description));
  if (promptCommands.length > 0) {
    lines.push("", "Workflows");
    for (const c of promptCommands) lines.push(row(`/${c.name}`, c.description));
  }
  const reachableCustom = customCommands.filter(
    (cmd) => !promptCommands.some((p) => p.name === cmd.name || p.aliases.includes(cmd.name)),
  );
  if (reachableCustom.length > 0) {
    lines.push("", "Custom");
    for (const c of reachableCustom) lines.push(row(`/${c.name}`, c.description));
  }
  lines.push("", "Keyboard shortcuts", ...TUI_SHORTCUTS.map(([key, what]) => row(key, what)));
  return lines.join("\n");
}

/**
 * Resolve `/model` arguments to a registry entry: `provider:model`, or a bare
 * model id (first provider that ships it).
 */
export function resolveModelTarget(
  target: string,
  models: ReadonlyArray<{ provider: string; id: string }>,
): string | null {
  const colon = target.indexOf(":");
  const provider = colon === -1 ? "" : target.slice(0, colon);
  const id = colon === -1 ? target : target.slice(colon + 1);
  const hit = models.find((m) => m.id === id && (!provider || m.provider === provider));
  return hit ? `${hit.provider}:${hit.id}` : null;
}
