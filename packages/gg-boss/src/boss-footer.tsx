import React from "react";
import { Text, Box } from "ink";
import { useTheme } from "@abukhaled/ogcoder/ui/theme";
import { getContextWindow } from "@abukhaled/ogcoder";
import { COLORS } from "./branding.js";

const PARTIAL_BLOCKS = [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];
const LIGHT_SHADE = "░";

const SHORT_MODELS: Record<string, string> = {
  "claude-opus-4-7": "Opus",
  "claude-sonnet-4-6": "Sonnet",
  "claude-haiku-4-5": "Haiku",
  "claude-haiku-4-5-20251001": "Haiku",
  "gpt-5.5": "GPT-5.5",
  "gpt-5.5-pro": "GPT-5.5 Pro",
  "gpt-5.4": "GPT-5.4",
  "gpt-5.4-mini": "GPT-5.4 Mini",
  "gpt-5.3-codex": "GPT-5.3 Codex",
};

function shortModel(model: string): string {
  return SHORT_MODELS[model] ?? model;
}

function getContextPercent(model: string, tokensIn: number): number {
  const limit = getContextWindow(model);
  if (!limit || tokensIn === 0) return 0;
  return Math.round((tokensIn / limit) * 100);
}

interface BossFooterProps {
  bossModel: string;
  workerModel: string;
  /** Total input tokens of the boss's last turn — drives the context bar. */
  tokensIn: number;
  exitPending: boolean;
}

/**
 * Footer for gg-boss that mirrors ggcoder's Footer visual style — context bar
 * with partial-block precision, percent, then BOTH models displayed in the
 * same bold/coloured treatment so neither feels secondary.
 */
export function BossFooter({
  bossModel,
  workerModel,
  tokensIn,
  exitPending,
}: BossFooterProps): React.ReactElement {
  const theme = useTheme();

  if (exitPending) {
    return (
      <Box paddingX={1}>
        <Text color={theme.warning}>Press Ctrl+C again to exit</Text>
      </Box>
    );
  }

  const contextPct = getContextPercent(bossModel, tokensIn);
  const contextColor =
    contextPct >= 80 ? theme.error : contextPct >= 50 ? theme.warning : theme.success;

  const sep = <Text color={theme.border}>{" │ "}</Text>;

  // Context bar — same partial-block precision as ggcoder's Footer.
  const barWidth = 8;
  const fillFloat = Math.min((contextPct / 100) * barWidth, barWidth);
  const barChars: React.ReactElement[] = [];
  for (let i = 0; i < barWidth; i++) {
    const cellFill = Math.max(0, Math.min(1, fillFloat - i));
    const eighths = Math.round(cellFill * 8);
    if (eighths === 8) {
      barChars.push(
        <Text key={i} color={contextColor}>
          {PARTIAL_BLOCKS[8]}
        </Text>,
      );
    } else if (eighths > 0) {
      barChars.push(
        <Text key={i} color={contextColor}>
          {PARTIAL_BLOCKS[eighths]}
        </Text>,
      );
    } else {
      barChars.push(
        <Text key={i} color={theme.textDim}>
          {LIGHT_SHADE}
        </Text>,
      );
    }
  }

  return (
    <Box paddingX={1}>
      <Box flexGrow={1} />
      <Box flexShrink={0}>
        <Text>{barChars}</Text>
        <Text color={contextColor}> {contextPct}%</Text>
        {sep}
        <Text color={theme.textDim}>boss </Text>
        <Text color={COLORS.primary} bold>
          {shortModel(bossModel)}
        </Text>
        {sep}
        <Text color={theme.textDim}>workers </Text>
        <Text color={COLORS.accent} bold>
          {shortModel(workerModel)}
        </Text>
      </Box>
    </Box>
  );
}
