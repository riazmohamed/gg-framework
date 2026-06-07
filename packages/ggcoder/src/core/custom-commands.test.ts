import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCustomCommands } from "./custom-commands.js";

// Point the global commands dir at a temp dir so the developer's real
// ~/.gg/commands never leaks into test results.
let globalDir: string;
vi.mock("../config.js", () => ({
  getAppPaths: () => ({ commandsDir: globalDir }),
}));

let cwd: string;

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), "ggcoder-cmds-cwd-"));
  globalDir = await fs.mkdtemp(path.join(os.tmpdir(), "ggcoder-cmds-global-"));
});

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
  await fs.rm(globalDir, { recursive: true, force: true });
});

async function writeCommand(dir: string, file: string, name: string, body: string) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, file),
    `---\nname: ${name}\ndescription: ${name} desc\n---\n\n${body}\n`,
  );
}

describe("loadCustomCommands", () => {
  it("loads commands from the global ~/.gg/commands dir", async () => {
    await writeCommand(globalDir, "deploy.md", "deploy", "Deploy the app.");

    const commands = await loadCustomCommands(cwd);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.name).toBe("deploy");
    expect(commands[0]?.source).toBe("global");
    expect(commands[0]?.prompt).toContain("Deploy the app.");
  });

  it("merges project and global commands", async () => {
    await writeCommand(path.join(cwd, ".gg", "commands"), "local.md", "local", "Local body.");
    await writeCommand(globalDir, "shared.md", "shared", "Shared body.");

    const commands = await loadCustomCommands(cwd);
    expect(commands.map((c) => c.name).sort()).toEqual(["local", "shared"]);
  });

  it("prefers the project command on a name collision", async () => {
    await writeCommand(path.join(cwd, ".gg", "commands"), "deploy.md", "deploy", "Project body.");
    await writeCommand(globalDir, "deploy.md", "deploy", "Global body.");

    const commands = await loadCustomCommands(cwd);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.source).toBe("project");
    expect(commands[0]?.prompt).toContain("Project body.");
  });

  it("returns empty when neither dir exists", async () => {
    await fs.rm(globalDir, { recursive: true, force: true });
    const commands = await loadCustomCommands(cwd);
    expect(commands).toEqual([]);
  });
});
