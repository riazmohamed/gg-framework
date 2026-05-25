import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink";
import { Writable } from "node:stream";
import { UserMessage } from "./UserMessage.js";
import { ThemeContext, loadTheme } from "../theme/theme.js";

function renderUserMessage(element: React.ReactElement): string {
  let output = "";
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  }) as NodeJS.WriteStream;
  stdout.columns = 100;
  stdout.rows = 30;
  stdout.isTTY = true;
  stdout.getColorDepth = () => 24;

  render(<ThemeContext.Provider value={loadTheme("dark")}>{element}</ThemeContext.Provider>, {
    stdout,
    patchConsole: false,
  }).unmount();
  return output.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
}

describe("UserMessage", () => {
  it("collapses submitted multiline prompts into one displayed user row", () => {
    const output = renderUserMessage(<UserMessage text={"first\nsecond\n\nthird"} />);

    expect(output).toContain("> first ⏎ second ⏎ third");
    expect(output).not.toContain("\nsecond");
  });

  it("renders a Gemini-style full-width half-line padded message box", () => {
    const output = renderUserMessage(<UserMessage text="hello" />);

    expect(output).toContain("▄".repeat(100));
    expect(output).toContain("> hello");
    expect(output).toContain("▀".repeat(100));
  });
});
