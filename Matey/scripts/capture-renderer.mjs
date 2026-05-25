import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const output = resolve(
  process.argv[2] ?? ".goal-artifacts/matey-design-replica/matey-1080x720.png",
);

await mkdir(dirname(output), { recursive: true });

const child = spawn(
  process.execPath,
  [
    "node_modules/electron/cli.js",
    "out/main/index.js",
    "--disable-gpu",
    "--no-sandbox",
    `--matey-screenshot=${output}`,
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

let log = "";
child.stdout.on("data", (chunk) => {
  log += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  log += chunk.toString();
});

const exitCode = await new Promise((resolveExit) => {
  child.on("exit", (code) => resolveExit(code ?? 1));
});

await writeFile(`${output}.log`, log);

if (exitCode !== 0) {
  throw new Error(
    `Electron screenshot capture failed with exit code ${exitCode}. See ${output}.log`,
  );
}

console.log(`Captured ${output}`);
