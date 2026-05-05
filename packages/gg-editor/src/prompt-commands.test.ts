import { describe, expect, it } from "vitest";
import { EDITOR_PROMPT_COMMANDS, getEditorPromptCommand } from "./prompt-commands.js";

describe("EDITOR_PROMPT_COMMANDS", () => {
  it("registers the four bundled commands", () => {
    expect(EDITOR_PROMPT_COMMANDS.map((c) => c.name).sort()).toEqual([
      "audit",
      "diagnose",
      "setup-channel",
      "youtube",
    ]);
  });

  it("every command has a non-empty prompt and description", () => {
    for (const cmd of EDITOR_PROMPT_COMMANDS) {
      expect(cmd.prompt.length).toBeGreaterThan(50);
      expect(cmd.description.length).toBeGreaterThan(0);
    }
  });

  it("aliases are unique across commands", () => {
    const seen = new Set<string>();
    for (const cmd of EDITOR_PROMPT_COMMANDS) {
      expect(seen.has(cmd.name)).toBe(false);
      seen.add(cmd.name);
      for (const a of cmd.aliases) {
        expect(seen.has(a)).toBe(false);
        seen.add(a);
      }
    }
  });
});

describe("getEditorPromptCommand", () => {
  it("resolves by primary name", () => {
    expect(getEditorPromptCommand("setup-channel")?.name).toBe("setup-channel");
    expect(getEditorPromptCommand("youtube")?.name).toBe("youtube");
  });

  it("resolves by alias", () => {
    expect(getEditorPromptCommand("brand-kit")?.name).toBe("setup-channel");
    expect(getEditorPromptCommand("yt")?.name).toBe("youtube");
    expect(getEditorPromptCommand("pre-render")?.name).toBe("audit");
    expect(getEditorPromptCommand("why-no-views")?.name).toBe("diagnose");
  });

  it("returns undefined for unknown names", () => {
    expect(getEditorPromptCommand("nope")).toBeUndefined();
    expect(getEditorPromptCommand("")).toBeUndefined();
  });
});
