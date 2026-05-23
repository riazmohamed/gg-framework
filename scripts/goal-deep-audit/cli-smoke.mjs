#!/usr/bin/env node
import { readdir, readFile, writeFile, mkdir, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const outDir = path.join(root, "scripts/goal-deep-audit");
const outPath = path.join(outDir, "cli-smoke.json");
const packagesDir = path.join(root, "packages");
const TIMEOUT_MS = Number(process.env.GOAL_AUDIT_TIMEOUT_MS || 60000);

function bins(pkg) {
  if (!pkg.bin) return [];
  if (typeof pkg.bin === "string") return [{ name: pkg.name, rel: pkg.bin }];
  return Object.entries(pkg.bin).map(([name, rel]) => ({ name, rel }));
}
async function canAccess(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
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
async function smokeBin(pkgDir, bin) {
  const abs = path.resolve(pkgDir, bin.rel);
  const item = {
    name: bin.name,
    path: path.relative(root, abs),
    exists: await canAccess(abs),
    probes: [],
  };
  if (!item.exists) {
    item.blocker =
      "built bin entry point missing; run package build first or fix package.json bin path";
    return item;
  }
  for (const args of [["--help"], ["--version"]])
    item.probes.push(await run("node", [abs, ...args], root));
  return item;
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
    const rec = {
      package: pkg.name || ent.name,
      path: path.relative(root, pkgDir),
      type: pkg.type || null,
      main: pkg.main || null,
      module: pkg.module || null,
      exports: pkg.exports || null,
      bins: [],
    };
    for (const b of bins(pkg)) rec.bins.push(await smokeBin(pkgDir, b));
    if (!rec.bins.length) rec.note = "No package bin field; CLI smoke not applicable.";
    result.packages.push(rec);
  }
  await writeFile(outPath, JSON.stringify(result, null, 2) + "\n");
  const bad = result.packages.flatMap((p) =>
    p.bins
      .filter(
        (b) =>
          !b.exists || b.probes.some((r) => r.timedOut || (r.exitCode !== 0 && r.exitCode !== 1)),
      )
      .map((b) => `${p.package}:${b.name}`),
  );
  console.log(
    `wrote ${path.relative(root, outPath)}; packages=${result.packages.length}; cliIssues=${bad.length}`,
  );
  if (bad.length) console.log(`cli issues: ${bad.join(", ")}`);
  process.exitCode = bad.length ? 1 : 0;
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
