import { describe, expect, it } from "vitest";
import { routePromptCommandInput } from "./prompt-routing.js";

describe("routePromptCommandInput", () => {
  it("substitutes Claude-style $ARGUMENTS placeholders", () => {
    const route = routePromptCommandInput(
      "/audit src/tools",
      [],
      [{ name: "audit", prompt: "Audit this scope: $ARGUMENTS" }],
    );

    expect(route?.fullPrompt).toBe("Audit this scope: src/tools");
  });

  it("appends args when a prompt has no $ARGUMENTS placeholder", () => {
    const route = routePromptCommandInput(
      "/audit src/tools",
      [],
      [{ name: "audit", prompt: "Audit the codebase." }],
    );

    expect(route?.fullPrompt).toBe("Audit the codebase.\n\n## User Instructions\n\nsrc/tools");
  });
});
