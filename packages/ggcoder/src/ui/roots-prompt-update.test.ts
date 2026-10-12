import { describe, expect, it } from "vitest";
import type { Message } from "@abukhaled/gg-ai";
import { noteRootsChange } from "./roots-prompt-update.js";

const system: Message = { role: "system", content: "prompt" };

describe("noteRootsChange", () => {
  it("asks for a rebuild before the conversation starts", () => {
    const messages: Message[] = [system];
    expect(noteRootsChange(messages, [], ["/a"])).toBe("rebuild");
    expect(messages).toHaveLength(1);
  });

  it("appends a hidden note mid-conversation instead of touching the prompt", () => {
    const messages: Message[] = [system, { role: "user", content: "hi" }];
    expect(noteRootsChange(messages, [], ["/a"])).toBe("noted");
    expect(messages[0]).toBe(system);
    const note = messages[2];
    expect(note?.role).toBe("user");
    expect(note?.provenance?.visibility).toBe("hidden");
    expect(note?.content).toContain("/a");
  });

  it("adds nothing when the roots did not change", () => {
    const messages: Message[] = [system, { role: "user", content: "hi" }];
    expect(noteRootsChange(messages, ["/a"], ["/a"])).toBe("unchanged");
    expect(messages).toHaveLength(2);
  });
});
