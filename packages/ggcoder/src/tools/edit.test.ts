import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createEditTool } from "./edit.js";

function resultToString(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "details" in result) {
    const details = (result as { details?: { diff?: string } }).details;
    return details?.diff ?? "";
  }
  return "";
}

describe("createEditTool", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "edit-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("replaces exact text and returns a diff", async () => {
    const filePath = path.join(tmpDir, "hello.txt");
    await fs.writeFile(filePath, "hello world\n");

    const tool = createEditTool(tmpDir);
    const result = await tool.execute(
      { file_path: "hello.txt", edits: [{ old_text: "hello", new_text: "goodbye" }] },
      { signal: new AbortController().signal, toolCallId: "test-1" },
    );

    const diff = resultToString(result);
    expect(diff).toContain("-hello world");
    expect(diff).toContain("+goodbye world");

    const written = await fs.readFile(filePath, "utf-8");
    expect(written).toBe("goodbye world\n");
  });

  it("applies multiple edits sequentially", async () => {
    const filePath = path.join(tmpDir, "multi.txt");
    await fs.writeFile(filePath, "alpha\nbeta\ngamma\n");

    const tool = createEditTool(tmpDir);
    const result = await tool.execute(
      {
        file_path: "multi.txt",
        edits: [
          { old_text: "alpha", new_text: "ALPHA" },
          { old_text: "gamma", new_text: "GAMMA" },
        ],
      },
      { signal: new AbortController().signal, toolCallId: "test-multi" },
    );

    const summary = typeof result === "string" ? result : (result as { content: string }).content;
    expect(summary).toContain("2 edits");

    const written = await fs.readFile(filePath, "utf-8");
    expect(written).toBe("ALPHA\nbeta\nGAMMA\n");
  });

  it("supports chained edits where later edits depend on earlier ones", async () => {
    const filePath = path.join(tmpDir, "chain.txt");
    await fs.writeFile(filePath, "foo\n");

    const tool = createEditTool(tmpDir);
    await tool.execute(
      {
        file_path: "chain.txt",
        edits: [
          { old_text: "foo", new_text: "bar" },
          { old_text: "bar", new_text: "baz" },
        ],
      },
      { signal: new AbortController().signal, toolCallId: "test-chain" },
    );

    const written = await fs.readFile(filePath, "utf-8");
    expect(written).toBe("baz\n");
  });

  it("reports edit index on failure within a multi-edit batch", async () => {
    const filePath = path.join(tmpDir, "batch.txt");
    await fs.writeFile(filePath, "one two three\n");

    const tool = createEditTool(tmpDir);
    await expect(
      tool.execute(
        {
          file_path: "batch.txt",
          edits: [
            { old_text: "one", new_text: "1" },
            { old_text: "missing", new_text: "x" },
          ],
        },
        { signal: new AbortController().signal, toolCallId: "test-batch" },
      ),
    ).rejects.toThrow(/edit 2\/2/);

    // Nothing should have been written — atomic
    const written = await fs.readFile(filePath, "utf-8");
    expect(written).toBe("one two three\n");
  });

  it("returns error string in plan mode", async () => {
    const filePath = path.join(tmpDir, "plan.txt");
    await fs.writeFile(filePath, "original\n");

    const planModeRef = { current: true };
    const tool = createEditTool(tmpDir, undefined, undefined, planModeRef);
    const result = await tool.execute(
      { file_path: "plan.txt", edits: [{ old_text: "original", new_text: "modified" }] },
      { signal: new AbortController().signal, toolCallId: "test-2" },
    );

    expect(result).toContain("Error: edit is restricted in plan mode");

    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe("original\n");
  });

  it("throws when file hasn't been read with readFiles tracking", async () => {
    const filePath = path.join(tmpDir, "unread.txt");
    await fs.writeFile(filePath, "content\n");

    const readFiles = new Set<string>();
    const tool = createEditTool(tmpDir, readFiles);

    await expect(
      tool.execute(
        { file_path: "unread.txt", edits: [{ old_text: "content", new_text: "new" }] },
        { signal: new AbortController().signal, toolCallId: "test-3" },
      ),
    ).rejects.toThrow("File must be read first");
  });

  it("allows edit when file is in readFiles set", async () => {
    const filePath = path.join(tmpDir, "tracked.txt");
    await fs.writeFile(filePath, "alpha beta\n");

    const readFiles = new Set<string>();
    readFiles.add(path.resolve(tmpDir, "tracked.txt"));

    const tool = createEditTool(tmpDir, readFiles);
    const result = await tool.execute(
      { file_path: "tracked.txt", edits: [{ old_text: "alpha", new_text: "gamma" }] },
      { signal: new AbortController().signal, toolCallId: "test-4" },
    );

    const diff = resultToString(result);
    expect(diff).toContain("-alpha beta");
    expect(diff).toContain("+gamma beta");

    const written = await fs.readFile(filePath, "utf-8");
    expect(written).toBe("gamma beta\n");
  });

  it("throws when old_text is not found", async () => {
    const filePath = path.join(tmpDir, "missing.txt");
    await fs.writeFile(filePath, "some content here\n");

    const tool = createEditTool(tmpDir);

    await expect(
      tool.execute(
        {
          file_path: "missing.txt",
          edits: [{ old_text: "nonexistent text", new_text: "replacement" }],
        },
        { signal: new AbortController().signal, toolCallId: "test-5" },
      ),
    ).rejects.toThrow("old_text not found");
  });

  it("throws when old_text matches multiple times", async () => {
    const filePath = path.join(tmpDir, "dupes.txt");
    await fs.writeFile(filePath, "foo bar foo baz foo\n");

    const tool = createEditTool(tmpDir);

    await expect(
      tool.execute(
        { file_path: "dupes.txt", edits: [{ old_text: "foo", new_text: "qux" }] },
        { signal: new AbortController().signal, toolCallId: "test-6" },
      ),
    ).rejects.toThrow(/found 3 times/);
  });

  it("handles fuzzy matching with trailing whitespace and smart quotes", async () => {
    const filePath = path.join(tmpDir, "fuzzy.txt");
    await fs.writeFile(filePath, "const msg = 'hello';  \nend\n");

    const tool = createEditTool(tmpDir);
    const result = await tool.execute(
      {
        file_path: "fuzzy.txt",
        edits: [
          {
            old_text: "const msg = \u2018hello\u2019;",
            new_text: "const msg = 'goodbye';",
          },
        ],
      },
      { signal: new AbortController().signal, toolCallId: "test-7" },
    );

    const diff = resultToString(result);
    expect(diff).toContain("+const msg = 'goodbye';");

    const written = await fs.readFile(filePath, "utf-8");
    expect(written).toContain("goodbye");
  });

  it("preserves CRLF line endings", async () => {
    const filePath = path.join(tmpDir, "crlf.txt");
    await fs.writeFile(filePath, "line one\r\nline two\r\nline three\r\n");

    const tool = createEditTool(tmpDir);
    const result = await tool.execute(
      { file_path: "crlf.txt", edits: [{ old_text: "line two", new_text: "line TWO" }] },
      { signal: new AbortController().signal, toolCallId: "test-8" },
    );

    const diff = resultToString(result);
    expect(diff).toContain("+line TWO");

    const written = await fs.readFile(filePath, "utf-8");
    expect(written).toBe("line one\r\nline TWO\r\nline three\r\n");
  });
});
