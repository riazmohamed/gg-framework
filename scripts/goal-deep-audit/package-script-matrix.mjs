#!/usr/bin/env node
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const outDir = path.join(root, "scripts/goal-deep-audit");
const outPath = path.join(outDir, "package-script-matrix.json");
const packagesDir = path.join(root, "packages");
const SAFE_NAMES = /^(build|check|typecheck|lint|test:[\w:-]+|format:check)$/;
const UNSAFE_NAMES =
  /^(prepare|prepublish|prepublishOnly|postinstall|install|dev|start|serve|watch|format|lint:fix)$/;
const TIMEOUT_MS = Number(process.env.GOAL_AUDIT_TIMEOUT_MS || 120000);

function classify(name, cmd) {
  const lower = `${name} ${cmd}`.toLowerCase();
  if (UNSAFE_NAMES.test(name))
    return { safe: false, reason: "skipped: lifecycle/server/watch/mutating script name" };
  if (!SAFE_NAMES.test(name))
    return { safe: false, reason: "skipped: script name not in conservative safe allowlist" };
  if (/(\b--watch\b|\bwatch\b|\bdev\b|\bserve\b|\bstart\b)/.test(lower))
    return { safe: false, reason: "skipped: likely long-running dev/server/watch command" };
  if (
    /(rm\s+-rf|rimraf|del-cli|prettier\s+--write|eslint[^&|;]*--fix|\bpublish\b|\bdeploy\b)/.test(
      lower,
    )
  )
    return { safe: false, reason: "skipped: mutating/destructive/publish command" };
  return { safe: true, reason: "safe allowlisted validation/build command" };
}

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const child = spawn(cmd, args, {
      cwd,
      shell: false,
      env: { ...process.env, CI: "1", NO_COLOR: "1" },
    });
    let stdout = "",
      stderr = "",
      timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        startedAt,
        endedAt: new Date().toISOString(),
        command: [cmd, ...args].join(" "),
        exitCode: timedOut ? null : code,
        timedOut,
        stdoutTail: stdout.slice(-4000),
        stderrTail: stderr.slice(-4000),
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        startedAt,
        endedAt: new Date().toISOString(),
        command: [cmd, ...args].join(" "),
        exitCode: null,
        error: String(err),
        stdoutTail: stdout.slice(-4000),
        stderrTail: stderr.slice(-4000),
      });
    });
  });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const entries = (await readdir(packagesDir, { withFileTypes: true })).filter((d) =>
    d.isDirectory(),
  );
  const result = {
    generatedAt: new Date().toISOString(),
    cwd: root,
    timeoutMs: TIMEOUT_MS,
    packages: [],
  };
  for (const ent of entries) {
    const pkgDir = path.join(packagesDir, ent.name);
    const pkgJsonPath = path.join(pkgDir, "package.json");
    if (!existsSync(pkgJsonPath)) continue;
    const pkg = JSON.parse(await readFile(pkgJsonPath, "utf8"));
    const record = {
      package: pkg.name || ent.name,
      path: path.relative(root, pkgDir),
      version: pkg.version || null,
      scripts: [],
    };
    for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
      const cls = classify(name, String(cmd));
      const item = { name, command: cmd, safe: cls.safe, reason: cls.reason };
      if (cls.safe) item.result = await run("pnpm", ["--dir", pkgDir, "run", name], root);
      record.scripts.push(item);
    }
    if (!record.scripts.length) record.note = "No declared npm scripts.";
    result.packages.push(record);
  }
  await writeFile(outPath, JSON.stringify(result, null, 2) + "\n");
  const failures = result.packages.flatMap((p) =>
    p.scripts
      .filter((s) => s.result && (s.result.timedOut || s.result.exitCode !== 0))
      .map((s) => `${p.package}:${s.name}`),
  );
  console.log(
    `wrote ${path.relative(root, outPath)}; packages=${result.packages.length}; failing=${failures.length}`,
  );
  if (failures.length) console.log(`failing scripts: ${failures.join(", ")}`);
  process.exitCode = failures.length ? 1 : 0;
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
