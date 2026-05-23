#!/usr/bin/env node
import { readdir, readFile, writeFile, mkdir, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const outDir = path.join(root, "scripts/goal-deep-audit");
const outPath = path.join(outDir, "package-clarity-audit.json");
const packagesDir = path.join(root, "packages");
const TIMEOUT_MS = Number(process.env.GOAL_AUDIT_TIMEOUT_MS || 120000);

async function canRead(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
async function text(p) {
  return readFile(p, "utf8");
}
function rel(p) {
  return path.relative(root, p);
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
        command: [cmd, ...args].join(" "),
        cwd: rel(cwd),
        startedAt,
        endedAt: new Date().toISOString(),
        exitCode: timedOut ? null : code,
        timedOut,
        stdoutTail: stdout.slice(-2500),
        stderrTail: stderr.slice(-2500),
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        command: [cmd, ...args].join(" "),
        cwd: rel(cwd),
        startedAt,
        endedAt: new Date().toISOString(),
        exitCode: null,
        error: String(err),
        stdoutTail: stdout.slice(-2500),
        stderrTail: stderr.slice(-2500),
      });
    });
  });
}
async function auditNode(pkgDir, ent) {
  const pkg = JSON.parse(await text(path.join(pkgDir, "package.json")));
  const issues = [],
    checks = [];
  const readme = await canRead(path.join(pkgDir, "README.md"));
  if (!readme) issues.push("missing README.md");
  if (pkg.bin)
    for (const [name, target] of Object.entries(
      typeof pkg.bin === "string" ? { [pkg.name]: pkg.bin } : pkg.bin,
    )) {
      if (!existsSync(path.join(pkgDir, target)))
        issues.push(`bin ${name} target missing: ${target}`);
      if (
        !existsSync(
          path.join(pkgDir, target.replace(/^\.\/dist\//, "./src/").replace(/\.js$/, ".ts")),
        )
      )
        checks.push(`bin ${name} has built target ${target}; source path inferred indirectly`);
    }
  const exportTargets = [];
  const collect = (v) => {
    if (typeof v === "string") exportTargets.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(collect);
  };
  collect(pkg.exports);
  if (pkg.main) exportTargets.push(pkg.main);
  if (pkg.types) exportTargets.push(pkg.types);
  for (const t of exportTargets.filter((t) => t.startsWith("./dist/")))
    if (!existsSync(path.join(pkgDir, t))) issues.push(`export/main/types target missing: ${t}`);
  if (pkg.files?.includes("dist") && !existsSync(path.join(pkgDir, "dist")))
    issues.push("files includes dist but dist directory is missing");
  if ((pkg.exports || pkg.types) && !existsSync(path.join(pkgDir, "src")))
    issues.push("exports/types declared but src directory is missing");
  if (!pkg.scripts?.check) issues.push("missing check script");
  if (pkg.scripts?.check) checks.push("npm check script declared");
  if (pkg.scripts?.test) checks.push("npm test script declared");
  return {
    kind: "node",
    package: pkg.name || ent,
    path: rel(pkgDir),
    version: pkg.version || null,
    readme,
    bin: pkg.bin || null,
    exports: pkg.exports || null,
    types: pkg.types || null,
    files: pkg.files || null,
    scripts: Object.keys(pkg.scripts || {}),
    checks,
    issues,
  };
}
async function auditOther(pkgDir, ent) {
  const files = await readdir(pkgDir);
  const readme = await canRead(path.join(pkgDir, "README.md"));
  const rec = {
    kind: "sdk",
    package: ent,
    path: rel(pkgDir),
    readme,
    manifests: [],
    sourceLayout: [],
    checks: [],
    issues: [],
  };
  for (const f of ["pyproject.toml", "go.mod", "Cargo.toml", "Package.swift", "gg_pixel.gemspec"])
    if (files.includes(f)) rec.manifests.push(f);
  if (!readme) rec.issues.push("missing README.md");
  if (files.includes("pyproject.toml")) {
    rec.kind = "python";
    rec.sourceLayout.push("src/gg_pixel", "tests");
    if (!existsSync(path.join(pkgDir, "src/gg_pixel/__init__.py")))
      rec.issues.push("missing src/gg_pixel/__init__.py");
    if (!existsSync(path.join(pkgDir, "tests"))) rec.issues.push("missing tests directory");
    rec.checks.push("pytest suite present");
  }
  if (files.includes("go.mod")) {
    rec.kind = "go";
    rec.sourceLayout.push("pixel.go", "examples/smoke");
    if (!existsSync(path.join(pkgDir, "pixel.go"))) rec.issues.push("missing pixel.go");
    rec.checks.push("go test ./...");
  }
  if (files.includes("Cargo.toml")) {
    rec.kind = "rust";
    rec.sourceLayout.push("src/lib.rs", "tests", "examples");
    if (!existsSync(path.join(pkgDir, "src/lib.rs"))) rec.issues.push("missing src/lib.rs");
    rec.checks.push("cargo test");
  }
  if (files.includes("Package.swift")) {
    rec.kind = "swift";
    rec.sourceLayout.push("Sources/GGPixel", "Tests/GGPixelTests");
    if (!existsSync(path.join(pkgDir, "Sources/GGPixel")))
      rec.issues.push("missing Sources/GGPixel");
    rec.checks.push("swift test");
  }
  if (files.includes("gg_pixel.gemspec")) {
    rec.kind = "ruby";
    rec.sourceLayout.push("lib/gg_pixel.rb");
    if (!existsSync(path.join(pkgDir, "lib/gg_pixel.rb")))
      rec.issues.push("missing lib/gg_pixel.rb");
    rec.checks.push("ruby syntax check");
  }
  if (!rec.manifests.length) rec.issues.push("no recognized package manifest");
  return rec;
}
async function main() {
  await mkdir(outDir, { recursive: true });
  const entries = (await readdir(packagesDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  const result = {
    generatedAt: new Date().toISOString(),
    cwd: root,
    timeoutMs: TIMEOUT_MS,
    packages: [],
    verification: [],
  };
  for (const ent of entries) {
    const pkgDir = path.join(packagesDir, ent.name);
    result.packages.push(
      existsSync(path.join(pkgDir, "package.json"))
        ? await auditNode(pkgDir, ent.name)
        : await auditOther(pkgDir, ent.name),
    );
  }
  const commands = [
    [
      existsSync(path.join(root, "packages/gg-pixel-py/.venv/bin/python"))
        ? path.join(root, "packages/gg-pixel-py/.venv/bin/python")
        : "python3",
      ["-m", "pytest", "packages/gg-pixel-py/tests"],
      root,
    ],
    ["go", ["test", "./..."], path.join(root, "packages/gg-pixel-go")],
    ["cargo", ["test"], path.join(root, "packages/gg-pixel-rs")],
    ["swift", ["test"], path.join(root, "packages/gg-pixel-swift")],
    ["ruby", ["-c", "lib/gg_pixel.rb"], path.join(root, "packages/gg-pixel-rb")],
  ];
  for (const [cmd, args, cwd] of commands) result.verification.push(await run(cmd, args, cwd));
  await writeFile(outPath, JSON.stringify(result, null, 2) + "\n");
  const issues = result.packages.flatMap((p) => p.issues.map((i) => `${p.package}: ${i}`));
  const failures = result.verification
    .filter((v) => v.exitCode !== 0 || v.timedOut)
    .map((v) => v.command);
  console.log(
    `wrote ${rel(outPath)}; packages=${result.packages.length}; issues=${issues.length}; verificationFailures=${failures.length}`,
  );
  if (issues.length) console.log(issues.join("\n"));
  if (failures.length) console.log(`failing verification: ${failures.join(", ")}`);
  process.exitCode = failures.length ? 1 : 0;
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
