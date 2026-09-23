import { describe, expect, it } from "vitest";
import { routePromptCommandInput } from "./prompt-routing.js";
import { expandPromptCommand } from "../core/prompt-command-expansion.js";

describe("routePromptCommandInput", () => {
  it("substitutes Claude-style $ARGUMENTS placeholders", () => {
    const route = routePromptCommandInput(
      "/audit src/tools",
      [],
      [{ name: "audit", prompt: "Audit this scope: $ARGUMENTS" }],
    );

    expect(route?.fullPrompt).toContain("Audit this scope: src/tools");
    expect(route?.fullPrompt).toBe(
      expandPromptCommand("Audit this scope: $ARGUMENTS", "src/tools"),
    );
  });

  it("substitutes $ARGUMENTS with no args and adds no invocation section", () => {
    const route = routePromptCommandInput(
      "/audit",
      [],
      [{ name: "audit", prompt: "Audit this scope: $ARGUMENTS" }],
    );

    expect(route?.fullPrompt).toBe("Audit this scope: ");
  });

  it("appends args when a prompt has no $ARGUMENTS placeholder", () => {
    const route = routePromptCommandInput(
      "/audit src/tools",
      [],
      [{ name: "audit", prompt: "Audit the codebase." }],
    );

    expect(route?.fullPrompt).toBe(expandPromptCommand("Audit the codebase.", "src/tools"));
    expect(route?.fullPrompt).toContain("## User Instructions\n\nsrc/tools");
  });
});
