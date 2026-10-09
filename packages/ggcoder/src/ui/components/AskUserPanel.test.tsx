import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "ink";
import { Writable } from "node:stream";
import { AskUserPanel } from "./AskUserPanel.js";
import { ThemeContext, loadTheme } from "../theme/theme.js";
import type { AskUserPrompt } from "../../core/ask-user.js";

const inputHandlers: Array<(input: string, key: Record<string, boolean>) => void> = [];

vi.mock("ink", async (importOriginal) => {
  const actual = await importOriginal<{ render: typeof render }>();
  return {
    ...actual,
    useInput: (handler: (input: string, key: Record<string, boolean>) => void) => {
      inputHandlers.push(handler);
    },
  };
});

const prompt: AskUserPrompt = {
  id: "ask-1",
  questions: [
    {
      id: "db",
      question: "Which database?",
      kind: "choice",
      detail: "Used for the session store",
      options: [
        { label: "Postgres", value: "pg", recommended: true },
        { label: "SQLite", hint: "Zero setup" },
      ],
    },
  ],
};

function renderPanel(deferred = false) {
  inputHandlers.length = 0;
  let output = "";
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  }) as NodeJS.WriteStream;
  stdout.columns = 80;
  stdout.rows = 30;
  const onAnswer = vi.fn();
  const onDismiss = vi.fn();
  render(
    <ThemeContext.Provider value={loadTheme("dark")}>
      <AskUserPanel
        prompt={prompt}
        deferred={deferred}
        width={80}
        onAnswer={onAnswer}
        onDismiss={onDismiss}
      />
    </ThemeContext.Provider>,
    { stdout, patchConsole: false },
  );
  const press = (input: string, key: Record<string, boolean> = {}) =>
    inputHandlers.at(-1)?.(input, key);
  return { output: () => output, onAnswer, onDismiss, press };
}

describe("AskUserPanel", () => {
  it("renders the question, options, recommendation, hint and free-text row", () => {
    const { output } = renderPanel();
    const text = output();
    expect(text).toContain("? Which database?");
    expect(text).toContain("Used for the session store");
    expect(text).toContain("1. Postgres");
    expect(text).toContain("(recommended)");
    expect(text).toContain("2. SQLite");
    expect(text).toContain("Zero setup");
    expect(text).toContain("3. Type an answer…");
  });

  it("answers on a number key and dismisses on Esc or Ctrl+C", async () => {
    const a = renderPanel();
    a.press("2");
    await vi.waitFor(() => expect(a.onAnswer).toHaveBeenCalledWith({ db: "SQLite" }));

    const b = renderPanel();
    b.press("", { escape: true });
    await vi.waitFor(() => expect(b.onDismiss).toHaveBeenCalled());

    const c = renderPanel();
    c.press("c", { ctrl: true });
    await vi.waitFor(() => expect(c.onDismiss).toHaveBeenCalled());
  });

  it("explains a deferred question", () => {
    expect(renderPanel(true).output()).toContain("carried on with its best guess");
  });
});
