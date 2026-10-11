import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCustomCommands } from "./custom-commands.js";

let root = "";

async function writeCommand(dir: string, file: string, body: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, file), body, "utf-8");
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "gg-custom-commands-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("loadCustomCommands", () => {
  it("test_loadCustomCommands_globalAndProject_mergesBoth", async () => {
    const globalDir = path.join(root, "home", ".gg", "commands");
    const cwd = path.join(root, "project");
    await writeCommand(globalDir, "tmc-read.md", "---\ndescription: Read mail\n---\nRead it.");
    await writeCommand(path.join(cwd, ".gg", "commands"), "ship.md", "Ship it.");

    const commands = await loadCustomCommands(cwd, globalDir);

    expect(commands.map((c) => c.name).sort()).toEqual(["ship", "tmc-read"]);
    expect(commands.find((c) => c.name === "tmc-read")?.description).toBe("Read mail");
  });

  it("test_loadCustomCommands_sameName_projectWins", async () => {
    const globalDir = path.join(root, "home", ".gg", "commands");
    const cwd = path.join(root, "project");
    await writeCommand(globalDir, "fix.md", "Global fix.");
    await writeCommand(path.join(cwd, ".gg", "commands"), "fix.md", "Project fix.");

    const commands = await loadCustomCommands(cwd, globalDir);

    expect(commands).toHaveLength(1);
    expect(commands[0]?.prompt).toBe("Project fix.");
  });

  it("test_loadCustomCommands_noDirectories_returnsEmpty", async () => {
    const commands = await loadCustomCommands(path.join(root, "none"), path.join(root, "nope"));

    expect(commands).toEqual([]);
  });
});
