import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { AskUserPrompt } from "../../core/ask-user.js";
import { useTheme } from "../theme/theme.js";
import { stripTerminalFocusSequences } from "../utils/terminal-input.js";
import {
  allowsText,
  createAskPickerState,
  reduceAskPicker,
  type AskPickerKey,
} from "../ask-user-state.js";

interface AskUserPanelProps {
  prompt: AskUserPrompt;
  /** The soft deadline passed: the agent moved on, an answer arrives late. */
  deferred?: boolean;
  width: number;
  /** Shown above the question (an MCP server's request message). */
  heading?: string;
  /** Why the last answer was refused; the form starts again below it. */
  error?: string;
  onAnswer: (answers: Record<string, string | string[]>) => void;
  onDismiss: () => void;
}

/**
 * The terminal rendering of an `ask_user` question: the desktop app's
 * clickable band as a keyboard picker. ↑↓ or a number picks, space checks on
 * multi-select, Enter confirms, Esc dismisses.
 */
export function AskUserPanel({
  prompt,
  deferred,
  width,
  heading,
  error,
  onAnswer,
  onDismiss,
}: AskUserPanelProps) {
  const theme = useTheme();
  const [state, setState] = useState(() => createAskPickerState(prompt.questions));

  // A new question replaces the old one in place.
  useEffect(() => setState(createAskPickerState(prompt.questions)), [prompt]);

  useEffect(() => {
    if (state.outcome === "answer") onAnswer(state.answers);
    else if (state.outcome === "dismiss") onDismiss();
  }, [state.outcome, state.answers, onAnswer, onDismiss]);

  useInput((rawInput, key) => {
    const input = stripTerminalFocusSequences(rawInput);
    if (!input && rawInput) return;
    let action: AskPickerKey | null = null;
    if (key.upArrow) action = { type: "up" };
    else if (key.downArrow) action = { type: "down" };
    else if (key.return) action = { type: "enter" };
    // Ctrl+C dismisses too: the input box that normally owns it is inactive.
    else if (key.escape || (key.ctrl && input === "c")) action = { type: "escape" };
    else if (key.backspace || key.delete) action = { type: "backspace" };
    else if (input === " " && !state.typing) action = { type: "space" };
    else if (input && !key.ctrl && !key.meta) action = { type: "char", char: input };
    if (action) {
      const next = action;
      setState((s) => reduceAskPicker(s, next));
    }
  });

  const question = state.questions[state.index];
  if (!question) return null;
  const options = question.kind === "text" ? [] : (question.options ?? []);
  const textRow = allowsText(question) && question.kind !== "text";
  const counter =
    state.questions.length > 1 ? ` (${state.index + 1}/${state.questions.length})` : "";
  const hint = state.typing
    ? "Enter to send · Esc to go back"
    : question.kind === "multi"
      ? "↑↓ move · space check · Enter confirm · Esc dismiss"
      : "↑↓ or number to pick · Enter confirm · Esc dismiss";

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={1}
      width={width}
      flexShrink={0}
    >
      {heading && <Text color={theme.text}>{heading}</Text>}
      {error && <Text color={theme.error}>{error}</Text>}
      <Text color={theme.accent} bold>
        ? {question.question}
        <Text color={theme.textDim}>{counter}</Text>
      </Text>
      {question.detail && <Text color={theme.textDim}>{question.detail}</Text>}
      {deferred && (
        <Text color={theme.warning}>
          The agent carried on with its best guess. Answering now sends your choice as a message.
        </Text>
      )}
      {options.map((option, i) => {
        const selected = !state.typing && state.cursor === i;
        const box = question.kind === "multi" ? (state.checked.includes(i) ? "[x] " : "[ ] ") : "";
        return (
          <Box key={`${question.id}-${i}`} flexDirection="column">
            <Text color={selected ? theme.commandColor : theme.text}>
              {selected ? "› " : "  "}
              {i + 1}. {box}
              {option.label}
              {option.recommended && <Text color={theme.success}> (recommended)</Text>}
            </Text>
            {option.hint && (
              <Text color={theme.textDim}>
                {"       "}
                {option.hint}
              </Text>
            )}
          </Box>
        );
      })}
      {textRow && !state.typing && (
        <Text color={state.cursor === options.length ? theme.commandColor : theme.textDim}>
          {state.cursor === options.length ? "› " : "  "}
          {options.length + 1}. Type an answer…
        </Text>
      )}
      {state.typing && (
        <Text>
          <Text color={theme.commandColor}>› </Text>
          {state.text}
          <Text inverse> </Text>
        </Text>
      )}
      <Text color={theme.textDim}>{hint}</Text>
    </Box>
  );
}
