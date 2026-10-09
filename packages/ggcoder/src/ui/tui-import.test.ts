import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../core/session-manager.js";
import { createImportCommand } from "./tui-import.js";
import { loadSessionRows } from "./sessions.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "../core/__fixtures__");
const ctx = {} as never;

async function setup(cwd = "/Users/dev/widgets") {
  const sessionsDir = await mkdtemp(path.join(os.tmpdir(), "tui-import-"));
  const command = createImportCommand({
    sessionsDir,
    cwd: () => cwd,
    provider: () => "anthropic",
    model: () => "claude-opus-5-5",
  });
  return { sessionsDir, command };
}

describe("/import", () => {
  it("imports a Codex transcript and names the session to resume", async () => {
    const { sessionsDir, command } = await setup();
    const text = await command.execute(path.join(fixtures, "codex-transcript.jsonl"), ctx);
    expect(text).toMatch(/^Imported \d+ messages from Codex/);
    const id = /--resume (\S+)/.exec(text)?.[1];
    expect(id).toBeTruthy();
    const resolved = await new SessionManager(sessionsDir).resolveCanonicalSession(
      id!,
      "/Users/dev/widgets",
    );
    expect(resolved).toBeTruthy();
  });

  it("adds the cd when the transcript belongs to another project", async () => {
    const { command } = await setup("/somewhere/else");
    const text = await command.execute(path.join(fixtures, "codex-transcript.jsonl"), ctx);
    expect(text).toContain('cd "/Users/dev/widgets" && ogcoder --resume');
  });

  it("explains usage and reports unreadable files", async () => {
    const { command } = await setup();
    expect(await command.execute("", ctx)).toContain("Usage: /import");
    expect(await command.execute("/no/such/file.jsonl", ctx)).toContain("Could not import");
  });
});

describe("ogcoder sessions rows", () => {
  it("lists foreign transcripts after own sessions, tagged by source", async () => {
    const sessionsDir = await mkdtemp(path.join(os.tmpdir(), "tui-rows-"));
    const rows = await loadSessionRows(sessionsDir, "/p", async () => [
      {
        id: "x",
        path: "/home/.claude/projects/p/x.jsonl",
        preview: "Fix   the\\nlogin flow please, it keeps timing out on slow networks",
        lastActiveDisplay: "2h ago",
        messageCount: 14,
        source: "claude-code",
      },
    ]);
    expect(rows).toEqual([
      {
        path: "/home/.claude/projects/p/x.jsonl",
        firstPrompt: "Fix the\\nlogin flow please, it keeps tim...",
        meta: "14 msgs · 2h ago",
        source: "claude-code",
      },
    ]);
  });
});
