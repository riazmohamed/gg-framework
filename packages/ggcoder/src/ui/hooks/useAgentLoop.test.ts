import { describe, expect, it } from "vitest";
import { shouldRetainThinkingDelta } from "./useAgentLoop.js";

describe("useAgentLoop thinking display", () => {
  it("does not retain provider reasoning in chat transcript state", () => {
    expect(shouldRetainThinkingDelta()).toBe(false);
  });
});
