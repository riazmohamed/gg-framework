import { describe, expect, it, vi } from "vitest";
import type { AuthStorage } from "../core/auth-storage.js";
import { createEnhanceCommand, describeEnhancement } from "./tui-enhance.js";

const auth = {
  resolveCredentials: vi.fn(async () => ({ accessToken: "tok", accountId: "acct" })),
} as unknown as AuthStorage;
const route = {
  provider: "openai" as const,
  model: "gpt-6.1-sol",
  maxTokens: 16384,
  cwd: process.cwd(),
  authStorage: auth,
};
const ctx = {} as never;

describe("/enhance", () => {
  it("rewrites the draft, puts it in the composer and lists corrected terms", async () => {
    const putInComposer = vi.fn();
    const enhance = vi.fn(async () => ({
      enhanced: "Add debouncing to the search input.",
      segments: [
        { kind: "text" as const, text: "Add " },
        { kind: "term" as const, text: "debouncing", original: "the delay thing", note: "wait" },
        { kind: "text" as const, text: " to the search input." },
      ],
    }));
    const command = createEnhanceCommand({ route: () => route, putInComposer, enhance });
    const text = await command.execute("make the search wait", ctx);
    expect(putInComposer).toHaveBeenCalledWith("Add debouncing to the search input.");
    expect(text).toContain("Rewritten prompt (now in the input box");
    expect(text).toContain("  Add debouncing to the search input.");
    expect(text).toContain("the delay thing → debouncing (wait)");
    expect(enhance).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        model: "gpt-6.1-sol",
        prompt: "make the search wait",
        apiKey: "tok",
        accountId: "acct",
      }),
    );
  });

  it("needs a draft and a login, and reports enhancer errors without touching the composer", async () => {
    const putInComposer = vi.fn();
    const failing = vi.fn(async () => {
      throw new Error("your original draft has been kept");
    });
    const command = createEnhanceCommand({ route: () => route, putInComposer, enhance: failing });
    expect(await command.execute("  ", ctx)).toBe("Usage: /enhance <draft prompt>");
    expect(await command.execute("x", ctx)).toBe(
      "Could not enhance the prompt: your original draft has been kept",
    );
    const noAuth = createEnhanceCommand({
      route: () => ({ ...route, authStorage: undefined }),
      putInComposer,
    });
    expect(await noAuth.execute("x", ctx)).toContain("needs a logged-in session");
    expect(putInComposer).not.toHaveBeenCalled();
  });

  it("omits the terms list when nothing was corrected", () => {
    expect(
      describeEnhancement({ enhanced: "x", segments: [{ kind: "text", text: "x" }] }),
    ).not.toContain("Terms:");
  });
});
