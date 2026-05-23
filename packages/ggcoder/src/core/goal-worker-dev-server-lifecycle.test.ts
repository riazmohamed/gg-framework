import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProcessManager } from "./process-manager.js";
import { createBashTool } from "../tools/bash.js";
import { createTaskOutputTool } from "../tools/task-output.js";

const toolContext = () => ({ toolCallId: "test", signal: new AbortController().signal });

async function waitForToolOutput(
  taskOutput: ReturnType<typeof createTaskOutputTool>,
  id: string,
  predicate: (output: string) => boolean,
): Promise<string> {
  let combined = "";
  for (let i = 0; i < 50; i += 1) {
    const output = await taskOutput.execute({ id, from_start: false }, toolContext());
    combined += String(output);
    if (predicate(combined)) return combined;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for worker tool output. Saw:\n${combined}`);
}

function parseBackgroundId(output: string): string {
  const match = output.match(/^ID: (.+)$/m);
  if (!match) throw new Error(`No background process id in output:\n${output}`);
  return match[1]!.trim();
}

async function writeDevServerFixture(tmpDir: string): Promise<string> {
  const fixture = path.join(tmpDir, "worker-dev-server.mjs");
  await fs.writeFile(
    fixture,
    `import http from 'node:http';\n` +
      `const server = http.createServer((_req, res) => res.end('ok'));\n` +
      `server.listen(0, '127.0.0.1', () => {\n` +
      `  const address = server.address();\n` +
      `  console.log('WORKER_DEV_SERVER_READY ' + address.port);\n` +
      `});\n` +
      `const interval = setInterval(() => console.log('WORKER_DEV_SERVER_TICK'), 250);\n` +
      `process.on('SIGTERM', () => {\n` +
      `  console.log('WORKER_DEV_SERVER_SIGTERM');\n` +
      `  clearInterval(interval);\n` +
      `  server.close(() => process.exit(0));\n` +
      `});\n`,
  );
  return fixture;
}

describe("Goal worker dev-server lifecycle", () => {
  let manager: ProcessManager | undefined;

  afterEach(() => {
    manager?.shutdownAll();
  });

  it("keeps worker-owned background dev servers available during the worker and cleans them up on worker CLI shutdown", async () => {
    manager = new ProcessManager();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gg-worker-dev-server-"));
    const fixture = await writeDevServerFixture(tmpDir);
    const bash = createBashTool(tmpDir, manager);
    const taskOutput = createTaskOutputTool(manager);

    const startOutput = await bash.execute(
      { command: `${process.execPath} ${fixture}`, run_in_background: true },
      toolContext(),
    );
    const id = parseBackgroundId(String(startOutput));

    const ready = await waitForToolOutput(taskOutput, id, (output) =>
      output.includes("WORKER_DEV_SERVER_READY"),
    );
    expect(ready).toContain("Process");
    expect(ready).toContain("running");

    manager.shutdownAll();

    let final = await manager.readOutput(id, true);
    for (let i = 0; i < 20 && !final.output.includes("WORKER_DEV_SERVER_SIGTERM"); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      final = await manager.readOutput(id, true);
    }
    expect(final.isRunning).toBe(false);
    expect(final.output).toContain("WORKER_DEV_SERVER_READY");
  }, 15_000);
});
