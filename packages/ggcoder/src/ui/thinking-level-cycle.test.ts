import { describe, expect, it } from "vitest";
import { getNextThinkingLevel } from "./App.js";

describe("getNextThinkingLevel", () => {
  it("cycles OpenAI GPT models through medium, high, xhigh, then off", () => {
    expect(getNextThinkingLevel("openai", "gpt-5.5", undefined)).toBe("medium");
    expect(getNextThinkingLevel("openai", "gpt-5.5", "medium")).toBe("high");
    expect(getNextThinkingLevel("openai", "gpt-5.5", "high")).toBe("xhigh");
    expect(getNextThinkingLevel("openai", "gpt-5.5", "xhigh")).toBeUndefined();
  });

  it("keeps non-OpenAI models as a binary max-thinking toggle", () => {
    expect(getNextThinkingLevel("anthropic", "claude-sonnet-4-6", undefined)).toBe("high");
    expect(getNextThinkingLevel("anthropic", "claude-sonnet-4-6", "high")).toBeUndefined();
  });

  it("keeps non-GPT OpenAI models as a binary max-thinking toggle", () => {
    expect(getNextThinkingLevel("openai", "o3", undefined)).toBe("high");
    expect(getNextThinkingLevel("openai", "o3", "high")).toBeUndefined();
  });
});
