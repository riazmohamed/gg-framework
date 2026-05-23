import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSourcePathTool } from "./source-path.js";

const OPENSRC_BIN_ENV = "GG_CODER_OPENSRC_BIN";
const OPENSRC_TEST_ENV = "GG_CODER_OPENSRC_TEST_ENV";

function context() {
  return { signal: new AbortController().signal, toolCallId: "test" };
}

function resultToString(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "content" in result) {
    return String((result as { content: unknown }).content);
  }
  return String(result);
}

async function writeFakeOpenSrc(tmpDir: string, source: string): Promise<string> {
  const binPath = path.join(tmpDir, "opensrc-fake.mjs");
  await fs.writeFile(binPath, source, "utf-8");
  await fs.chmod(binPath, 0o755);
  return binPath;
}

describe("createSourcePathTool", () => {
  let tmpDir: string;
  let originalOverride: string | undefined;
  let originalTestEnv: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "source-path-test-"));
    originalOverride = process.env[OPENSRC_BIN_ENV];
    originalTestEnv = process.env[OPENSRC_TEST_ENV];
  });

  afterEach(async () => {
    if (originalOverride === undefined) {
      delete process.env[OPENSRC_BIN_ENV];
    } else {
      process.env[OPENSRC_BIN_ENV] = originalOverride;
    }
    if (originalTestEnv === undefined) {
      delete process.env[OPENSRC_TEST_ENV];
    } else {
      process.env[OPENSRC_TEST_ENV] = originalTestEnv;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns the resolved source path from opensrc", async () => {
    process.env[OPENSRC_BIN_ENV] = await writeFakeOpenSrc(
      tmpDir,
      `console.log("/tmp/opensrc/zod/4.4.3");\n`,
    );
    const tool = createSourcePathTool(tmpDir);

    const result = resultToString(await tool.execute({ package: "zod" }, context()));

    expect(result).toContain("Source path: /tmp/opensrc/zod/4.4.3");
    expect(result).toContain("Use read, grep, find, or ls");
  });

  it("passes the project cwd to opensrc for lockfile-aware resolution", async () => {
    const argsFile = path.join(tmpDir, "args.json");
    process.env[OPENSRC_BIN_ENV] = await writeFakeOpenSrc(
      tmpDir,
      `import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));\nconsole.log("/tmp/opensrc/react/19.0.0");\n`,
    );
    const tool = createSourcePathTool(tmpDir);

    const result = resultToString(await tool.execute({ package: "react" }, context()));
    const args = JSON.parse(await fs.readFile(argsFile, "utf-8")) as string[];

    expect(result).toContain("Source path:");
    expect(args).toEqual(["path", "react", "--cwd", tmpDir]);
  });

  it("inherits environment variables needed by opensrc", async () => {
    process.env[OPENSRC_TEST_ENV] = "available";
    process.env[OPENSRC_BIN_ENV] = await writeFakeOpenSrc(
      tmpDir,
      `if (process.env.${OPENSRC_TEST_ENV} !== "available") process.exit(2);\nconsole.log("/tmp/opensrc/env/1.0.0");\n`,
    );
    const tool = createSourcePathTool(tmpDir);

    const result = resultToString(await tool.execute({ package: "env-package" }, context()));

    expect(result).toContain("Source path: /tmp/opensrc/env/1.0.0");
  });

  it("reports opensrc failures without throwing", async () => {
    process.env[OPENSRC_BIN_ENV] = await writeFakeOpenSrc(
      tmpDir,
      `console.error("package not found");\nprocess.exit(1);\n`,
    );
    const tool = createSourcePathTool(tmpDir);

    const result = resultToString(await tool.execute({ package: "does-not-exist" }, context()));

    expect(result).toContain("Error: opensrc failed");
    expect(result).toContain("package not found");
  });
});
