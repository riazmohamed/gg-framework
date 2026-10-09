import { describe, expect, it, vi } from "vitest";
import {
  createTuiSlashRegistry,
  formatTuiHelp,
  isRegistryCommand,
  resolveModelTarget,
} from "./tui-slash-commands.js";
import { handleUiSlashCommand } from "./submit-slash-commands.js";
import type { CustomCommand } from "../core/custom-commands.js";

describe("TUI slash registry", () => {
  const registry = createTuiSlashRegistry();

  it("exposes the shared commands the terminal app used to drop", () => {
    for (const input of ["/settings", "/session", "/new", "/add-dir ../x", "/remove-dir"]) {
      expect(isRegistryCommand(registry, input), input).toBe(true);
    }
  });

  it("leaves the commands App.tsx owns to App.tsx", () => {
    for (const input of [
      "/model",
      "/model openai:gpt-6.1-sol",
      "/compact",
      "/quit",
      "/rewind",
      "/branch",
      "/branches",
      "/help",
    ]) {
      expect(isRegistryCommand(registry, input), input).toBe(false);
    }
    expect(isRegistryCommand(registry, "plain text")).toBe(false);
    expect(isRegistryCommand(registry, "/not-a-command")).toBe(false);
  });

  it("lists every reachable command and the shortcuts in /help", () => {
    const custom: CustomCommand[] = [
      { name: "ship", description: "Ship it", prompt: "", filePath: "", source: "project" },
      { name: "init", description: "Shadowed", prompt: "", filePath: "", source: "project" },
    ];
    const help = formatTuiHelp(
      registry,
      [{ name: "init", aliases: [], description: "Generate CLAUDE.md", prompt: "" }],
      custom,
    );
    expect(help).toContain("/compact [focus]");
    expect(help).toContain("/add-dir [path]");
    expect(help).toContain("/settings [key] [value]");
    expect(help).toContain("/ship");
    expect(help).not.toContain("Shadowed");
    expect(help).toContain("Keyboard shortcuts");
    expect(help).toContain("Shift+Tab");
  });
});

describe("handleUiSlashCommand /compact", () => {
  const actions = () => ({
    openModelSelector: vi.fn(),
    switchModel: vi.fn((): string | null => null),
    showInfo: vi.fn(),
    compactConversation: vi.fn(async () => {}),
    quit: vi.fn(),
    clearSession: vi.fn(),
    openThemeSelector: vi.fn(),
    toggleMarkdown: vi.fn(),
    clearApprovedPlan: vi.fn(),
  });

  it("passes the focus text through", async () => {
    const a = actions();
    expect(await handleUiSlashCommand("/compact the auth refactor", a)).toBe(true);
    expect(a.compactConversation).toHaveBeenCalledWith("the auth refactor");
  });

  it("compacts without a focus for the bare command and its alias", async () => {
    for (const input of ["/compact", "/c"]) {
      const a = actions();
      expect(await handleUiSlashCommand(input, a)).toBe(true);
      expect(a.compactConversation).toHaveBeenCalledWith(undefined);
    }
  });

  it("does not treat other words starting with /c as compaction", async () => {
    const a = actions();
    expect(await handleUiSlashCommand("/clearplan", a)).toBe(true);
    expect(a.compactConversation).not.toHaveBeenCalled();
    expect(await handleUiSlashCommand("/config", actions())).toBe(false);
  });
});

describe("/model <target>", () => {
  const models = [
    { provider: "anthropic", id: "claude-opus-5-5" },
    { provider: "openai", id: "gpt-6.1-sol" },
  ];

  it("resolves provider:model and bare ids, and rejects unknown ones", () => {
    expect(resolveModelTarget("openai:gpt-6.1-sol", models)).toBe("openai:gpt-6.1-sol");
    expect(resolveModelTarget("claude-opus-5-5", models)).toBe("anthropic:claude-opus-5-5");
    expect(resolveModelTarget("anthropic:gpt-6.1-sol", models)).toBeNull();
    expect(resolveModelTarget("nope", models)).toBeNull();
  });

  it("opens the picker without args and switches directly with one", async () => {
    const open = vi.fn();
    const switchModel = vi.fn((): string | null => null);
    const base = {
      openModelSelector: open,
      switchModel,
      showInfo: vi.fn(),
      compactConversation: vi.fn(async () => {}),
      quit: vi.fn(),
      clearSession: vi.fn(),
      openThemeSelector: vi.fn(),
      toggleMarkdown: vi.fn(),
      clearApprovedPlan: vi.fn(),
    };
    await handleUiSlashCommand("/model", base);
    expect(open).toHaveBeenCalledTimes(1);
    await handleUiSlashCommand("/m openai:gpt-6.1-sol", base);
    expect(switchModel).toHaveBeenCalledWith("openai:gpt-6.1-sol");
    expect(open).toHaveBeenCalledTimes(1);
  });
});
