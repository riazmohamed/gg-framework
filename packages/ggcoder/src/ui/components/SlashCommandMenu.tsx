import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/theme.js";

export interface SlashCommandInfo {
  name: string;
  aliases: string[];
  description: string;
}

interface SlashCommandMenuProps {
  commands: SlashCommandInfo[];
  filter: string;
  selectedIndex: number;
}

const WINDOW_SIZE = 6;

export function SlashCommandMenu({ commands, filter, selectedIndex }: SlashCommandMenuProps) {
  const theme = useTheme();

  const filtered = commands.filter((cmd) => {
    if (!filter) return true;
    const lower = filter.toLowerCase();
    return (
      cmd.name.toLowerCase().startsWith(lower) ||
      cmd.aliases.some((a) => a.toLowerCase().startsWith(lower))
    );
  });

  if (filtered.length === 0) return null;

  const total = filtered.length;
  const idx = Math.min(Math.max(selectedIndex, 0), total - 1);

  // Sliding window keeps the selected item visible without dumping the
  // whole list (which gets clipped on short terminals).
  const start =
    total <= WINDOW_SIZE
      ? 0
      : Math.max(0, Math.min(idx - Math.floor(WINDOW_SIZE / 2), total - WINDOW_SIZE));
  const end = Math.min(start + WINDOW_SIZE, total);
  const visible = filtered.slice(start, end);

  const hasAbove = start > 0;
  const hasBelow = end < total;

  return (
    <Box flexDirection="column" paddingLeft={2} paddingRight={1} marginBottom={0}>
      {hasAbove && <Text color={theme.border}> ↑ {start} more</Text>}
      {visible.map((cmd, i) => {
        const actualIndex = start + i;
        const isSelected = actualIndex === idx;
        const aliasStr =
          cmd.aliases.length > 0 ? ` (${cmd.aliases.map((a) => "/" + a).join(", ")})` : "";
        return (
          <Box key={cmd.name}>
            <Text color={isSelected ? theme.commandColor : theme.textDim}>
              {isSelected ? "› " : "  "}
            </Text>
            <Text color={isSelected ? theme.commandColor : theme.text} bold={isSelected}>
              /{cmd.name}
            </Text>
            <Text color={theme.textDim}>{aliasStr}</Text>
            <Text color={theme.textDim}> — {cmd.description}</Text>
          </Box>
        );
      })}
      {hasBelow && <Text color={theme.border}> ↓ {total - end} more</Text>}
      <Box>
        <Text color={theme.border}> ↑↓ navigate · Enter select · Esc cancel</Text>
      </Box>
    </Box>
  );
}

/** Filter commands by partial name/alias match */
export function filterCommands(commands: SlashCommandInfo[], filter: string): SlashCommandInfo[] {
  if (!filter) return commands;
  const lower = filter.toLowerCase();
  return commands.filter(
    (cmd) =>
      cmd.name.toLowerCase().startsWith(lower) ||
      cmd.aliases.some((a) => a.toLowerCase().startsWith(lower)),
  );
}
