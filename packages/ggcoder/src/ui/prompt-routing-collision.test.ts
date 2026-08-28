import { describe, it, expect } from "vitest";
import { routePromptCommandInput } from "./prompt-routing.js";
import { PROMPT_COMMANDS } from "../core/prompt-commands.js";

/**
 * A user file at ~/.gg/commands/<name>.md that collides with a built-in prompt
 * command is unreachable: routing resolves built-ins first. The slash menu must
 * not list it, or the menu offers a row that runs something else — which is
 * also what produced duplicate React keys for `nuclear-commit`.
 */
describe("custom command shadowed by a built-in", () => {
  const shadowed = [{ name: "nuclear-commit", prompt: "MY OWN VERSION" }];

  it("routes a colliding name to the built-in, not the custom file", () => {
    const route = routePromptCommandInput("/nuclear-commit", PROMPT_COMMANDS, shadowed);
    expect(route).not.toBeNull();
    expect(route?.promptText).not.toBe("MY OWN VERSION");
  });

  it("still routes non-colliding custom commands to the custom file", () => {
    const custom = [{ name: "totally-unique-cmd", prompt: "MY OWN VERSION" }];
    const route = routePromptCommandInput("/totally-unique-cmd", PROMPT_COMMANDS, custom);
    expect(route?.promptText).toBe("MY OWN VERSION");
  });

  it("leaves exactly one entry after filtering collisions out of the menu list", () => {
    const visible = shadowed.filter(
      (cmd) => !PROMPT_COMMANDS.some((p) => p.name === cmd.name || p.aliases.includes(cmd.name)),
    );
    const names = [...PROMPT_COMMANDS.map((p) => p.name), ...visible.map((c) => c.name)];
    expect(names.filter((n) => n === "nuclear-commit")).toHaveLength(1);
  });
});
