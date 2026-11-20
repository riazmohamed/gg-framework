import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../core/session-manager.js";
import { firstPromptLabel } from "./sessions.js";

const info = (preview?: string): SessionInfo =>
  ({
    path: "/tmp/s.jsonl",
    id: "s",
    cwd: "/tmp",
    timestamp: new Date().toISOString(),
    messageCount: 2,
    ...(preview !== undefined ? { preview } : {}),
  }) as SessionInfo;

describe("firstPromptLabel", () => {
  it("test_firstPromptLabel_previewPresent_usesListPreview", () => {
    expect(firstPromptLabel(info("fix the login bug"))).toBe("fix the login bug");
  });

  it("test_firstPromptLabel_longPreview_truncatesTo40", () => {
    expect(firstPromptLabel(info("x".repeat(60)))).toBe("x".repeat(40) + "...");
  });

  it("test_firstPromptLabel_noPreview_saysNoPrompt", () => {
    expect(firstPromptLabel(info())).toBe("(no prompt)");
    expect(firstPromptLabel(info("   "))).toBe("(no prompt)");
  });
});
