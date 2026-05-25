import { describe, expect, it } from "vitest";
import os from "node:os";
import { createTools } from "./index.js";
import { buildSystemPrompt } from "../system-prompt.js";

describe("legacy plan mode removal", () => {
  const retiredEnterToolName = `enter_${"plan"}`;
  const retiredExitToolName = `exit_${"plan"}`;

  it("does not register retired plan transition tools", () => {
    const { tools, processManager } = createTools(os.tmpdir());

    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).not.toContain(retiredEnterToolName);
    expect(toolNames).not.toContain(retiredExitToolName);
    processManager.shutdownAll();
  });

  it("does not render retired plan tools even if stale tool names are supplied", async () => {
    const prompt = await buildSystemPrompt(os.tmpdir(), [], false, undefined, [
      "read",
      retiredEnterToolName,
      retiredExitToolName,
    ]);

    expect(prompt).toContain("**read**");
    expect(prompt).not.toContain(`**${retiredEnterToolName}**`);
    expect(prompt).not.toContain(`**${retiredExitToolName}**`);
  });

  it("ignores the retired planMode prompt flag", async () => {
    const prompt = await buildSystemPrompt(os.tmpdir(), [], true, undefined, [
      "read",
      "write",
      "edit",
      "bash",
      retiredEnterToolName,
      retiredExitToolName,
    ]);

    expect(prompt).not.toContain("Plan Mode (ACTIVE)");
    expect(prompt).not.toContain("Restricted: bash, edit, write except .gg/plans/");
    expect(prompt).not.toContain(retiredExitToolName);
    expect(prompt).not.toContain(retiredEnterToolName);
  });
});
