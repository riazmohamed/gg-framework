import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "./branding.js";
import type { WorkerView } from "./boss-store.js";

const STATUS_GLYPH: Record<WorkerView["status"], string> = {
  idle: "○",
  working: "●",
  error: "✗",
};

function statusColor(status: WorkerView["status"]): string {
  if (status === "working") return COLORS.accent;
  if (status === "error") return COLORS.error;
  return COLORS.textDim;
}

const SHORT: Record<string, string> = {
  "claude-opus-4-7": "Opus",
  "claude-sonnet-4-6": "Sonnet",
  "claude-haiku-4-5": "Haiku",
  "claude-haiku-4-5-20251001": "Haiku",
  "gpt-5.5": "GPT-5.5",
  "gpt-5.5-pro": "GPT-5.5 Pro",
  "gpt-5.4": "GPT-5.4",
};

function shortModel(model: string): string {
  return SHORT[model] ?? model;
}

interface BossFooterProps {
  workers: WorkerView[];
  bossModel: string;
  workerModel: string;
  pendingUserMessages: number;
  exitPending: boolean;
}

export function BossFooter({
  workers,
  bossModel,
  workerModel,
  pendingUserMessages,
  exitPending,
}: BossFooterProps): React.ReactElement {
  if (exitPending) {
    return (
      <Box paddingX={1}>
        <Text color={COLORS.warning}>Press Ctrl+C again to exit</Text>
      </Box>
    );
  }

  const sep = <Text color={COLORS.textDim}>{" │ "}</Text>;

  return (
    <Box paddingX={1}>
      <Box flexGrow={1}>
        {workers.map((w, i) => (
          <React.Fragment key={w.name}>
            {i > 0 && <Text color={COLORS.textDim}>{"  "}</Text>}
            <Text color={statusColor(w.status)}>{STATUS_GLYPH[w.status]} </Text>
            <Text
              color={
                w.status === "working"
                  ? COLORS.text
                  : w.status === "error"
                    ? COLORS.error
                    : COLORS.textDim
              }
              bold={w.status === "working"}
            >
              {w.name}
            </Text>
          </React.Fragment>
        ))}
        {pendingUserMessages > 0 && (
          <>
            <Text color={COLORS.textDim}>{"   "}</Text>
            <Text color={COLORS.warning}>
              {pendingUserMessages} message{pendingUserMessages === 1 ? "" : "s"} queued
            </Text>
          </>
        )}
      </Box>
      <Box flexShrink={0}>
        <Text color={COLORS.primary} bold>
          {shortModel(bossModel)}
        </Text>
        {sep}
        <Text color={COLORS.textDim}>workers </Text>
        <Text color={COLORS.accent}>{shortModel(workerModel)}</Text>
      </Box>
    </Box>
  );
}
