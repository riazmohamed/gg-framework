import type { AskOption, AskQuestion } from "../core/ask-user.js";

/**
 * Keyboard state for the terminal `ask_user` picker. Pure so every key path is
 * unit-testable; the Ink component only renders it and forwards keys.
 *
 * Each question shows its options, plus a "Type an answer" row when free text
 * is allowed. A `text` question opens straight into typing.
 */
export interface AskPickerState {
  questions: AskQuestion[];
  index: number;
  cursor: number;
  /** Checked option indexes for the current `multi` question. */
  checked: number[];
  typing: boolean;
  text: string;
  answers: Record<string, string | string[]>;
  /** Set once every question is answered (`answer`) or the user dismissed it. */
  outcome?: "answer" | "dismiss";
}

export type AskPickerKey =
  | { type: "up" }
  | { type: "down" }
  | { type: "space" }
  | { type: "enter" }
  | { type: "escape" }
  | { type: "backspace" }
  | { type: "char"; char: string };

export function optionValue(option: AskOption): string {
  return option.value ?? option.label;
}

export function allowsText(question: AskQuestion): boolean {
  return question.kind === "text" || question.allowOther !== false;
}

/** Rows for a question: its options, then the free-text row when allowed. */
export function rowCount(question: AskQuestion): number {
  const options = question.kind === "text" ? 0 : (question.options?.length ?? 0);
  return options + (allowsText(question) && question.kind !== "text" ? 1 : 0);
}

function startQuestion(state: AskPickerState, index: number): AskPickerState {
  const question = state.questions[index];
  return {
    ...state,
    index,
    cursor: 0,
    checked: [],
    typing: question?.kind === "text",
    text: "",
  };
}

export function createAskPickerState(questions: AskQuestion[]): AskPickerState {
  return startQuestion(
    { questions, index: 0, cursor: 0, checked: [], typing: false, text: "", answers: {} },
    0,
  );
}

function record(state: AskPickerState, answer: string | string[]): AskPickerState {
  const question = state.questions[state.index];
  const answers = { ...state.answers, [question.id]: answer };
  if (state.index + 1 >= state.questions.length) return { ...state, answers, outcome: "answer" };
  return startQuestion({ ...state, answers }, state.index + 1);
}

export function reduceAskPicker(state: AskPickerState, key: AskPickerKey): AskPickerState {
  if (state.outcome) return state;
  const question = state.questions[state.index];
  const options = question.kind === "text" ? [] : (question.options ?? []);

  if (state.typing) {
    switch (key.type) {
      case "char":
        return { ...state, text: state.text + key.char };
      case "backspace":
        return { ...state, text: state.text.slice(0, -1) };
      case "enter": {
        const text = state.text.trim();
        return text ? record(state, text) : state;
      }
      case "escape":
        // A text-only question has nowhere to go back to: dismiss it.
        return question.kind === "text"
          ? { ...state, outcome: "dismiss" }
          : { ...state, typing: false, text: "" };
      default:
        return state;
    }
  }

  const rows = rowCount(question);
  switch (key.type) {
    case "up":
      return { ...state, cursor: (state.cursor - 1 + rows) % rows };
    case "down":
      return { ...state, cursor: (state.cursor + 1) % rows };
    case "escape":
      return { ...state, outcome: "dismiss" };
    case "char": {
      const n = Number.parseInt(key.char, 10);
      if (!Number.isInteger(n) || n < 1 || n > rows) return state;
      const moved = { ...state, cursor: n - 1 };
      // A number picks outright on single-answer questions; on `multi` it toggles.
      if (question.kind === "multi") return reduceAskPicker(moved, { type: "space" });
      return reduceAskPicker(moved, { type: "enter" });
    }
    case "space": {
      if (question.kind !== "multi" || state.cursor >= options.length) return state;
      const checked = state.checked.includes(state.cursor)
        ? state.checked.filter((i) => i !== state.cursor)
        : [...state.checked, state.cursor].sort((a, b) => a - b);
      return { ...state, checked };
    }
    case "enter": {
      if (state.cursor >= options.length) return { ...state, typing: true, text: "" };
      if (question.kind === "multi") {
        const picked = state.checked.length > 0 ? state.checked : [state.cursor];
        return record(
          state,
          picked.map((i) => optionValue(options[i])),
        );
      }
      return record(state, optionValue(options[state.cursor]));
    }
    default:
      return state;
  }
}
