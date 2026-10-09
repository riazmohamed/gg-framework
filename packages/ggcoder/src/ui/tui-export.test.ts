import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Message } from "@abukhaled/gg-ai";
import { createExportCommand, exportTranscript, parseExportArgs } from "./tui-export.js";

const messages: Message[] = [
  { role: "system", content: "secret system prompt" },
  { role: "user", content: "Rename the helper" },
  {
    role: "assistant",
    content: [
      { type: "text", text: "Reading it first." },
      { type: "tool_call", id: "t1", name: "read", args: { file_path: "src/a.ts" } },
    ],
  },
  {
    role: "tool",
    content: [{ type: "tool_result", toolCallId: "t1", content: "export const a = 1;" }],
  },
  { role: "assistant", content: "Done." },
];

async function source() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "tui-export-"));
  return { cwd, provider: "anthropic", model: "claude-opus-5-5", sessionId: "abc123", messages };
}

describe("/export", () => {
  it("parses options", () => {
    expect(parseExportArgs("")).toEqual({
      toolDetail: "summary",
      includeThinking: false,
      force: false,
    });
    expect(parseExportArgs("notes.md --tools full --thinking --force")).toEqual({
      file: "notes.md",
      toolDetail: "full",
      includeThinking: true,
      force: true,
    });
    expect(parseExportArgs("--tools loud")).toEqual({
      error: "--tools takes none, summary or full.",
    });
    expect(parseExportArgs("a.md b.md")).toHaveProperty("error");
    expect(parseExportArgs("--nope")).toEqual({ error: "Unknown option: --nope" });
  });

  it("writes a timestamped Markdown file in the project by default", async () => {
    const src = await source();
    const message = await exportTranscript(src, "");
    const [file] = await readdir(src.cwd);
    expect(file).toMatch(/^your-session-\d{4}-\d{2}-\d{2}-\d{4}\.md$/);
    expect(message).toBe(`Exported the conversation to ${path.join(src.cwd, file)}`);
    const markdown = await readFile(path.join(src.cwd, file), "utf8");
    expect(markdown).toContain("Rename the helper");
    expect(markdown).toContain("Done.");
    expect(markdown).not.toContain("secret system prompt");
  });

  it("adds .md, and refuses to overwrite without --force", async () => {
    const src = await source();
    await writeFile(path.join(src.cwd, "chat.md"), "keep me");
    expect(await exportTranscript(src, "chat")).toContain("already exists");
    expect(await readFile(path.join(src.cwd, "chat.md"), "utf8")).toBe("keep me");
    expect(await exportTranscript(src, "chat --force")).toContain("chat.md");
    expect(await readFile(path.join(src.cwd, "chat.md"), "utf8")).toContain("Rename the helper");
  });

  it("says so when there is nothing to export, and reads live state per call", async () => {
    const src = await source();
    let live: Message[] = [messages[0]];
    const command = createExportCommand(() => ({ ...src, messages: live }));
    expect(await command.execute("", {} as never)).toBe("Nothing to export yet.");
    live = messages;
    expect(await command.execute("x.md", {} as never)).toContain("x.md");
  });
});
