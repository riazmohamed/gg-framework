#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendEntry,
  isEyesActive,
  journalCount,
  readJournal,
  updateEntry,
  type JournalKind,
  type JournalStatus,
} from "./journal.js";
import { readManifest as readManifestShared, type Manifest, type ProbeEntry } from "./manifest.js";

// In dev: __dirname = packages/ggcoder-eyes/src. After build: dist/.
// Probes + shared live at ../probes and ../shared relative to the built file.
const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const PROBES_DIR = join(PKG_ROOT, "probes");
const SHARED_DIR = join(PKG_ROOT, "shared");
const EYES_DIR = resolve(process.cwd(), ".gg/eyes");
const MANIFEST = join(EYES_DIR, "manifest.json");

const GITIGNORE_ENTRIES = [
  ".gg/eyes/out/",
  ".gg/eyes/state/",
  ".gg/eyes/bin/",
  ".gg/eyes/recordings/",
  ".gg/eyes/auth/",
  ".gg/eyes/remote.json",
  ".gg/eyes/_lib.sh",
  ".gg/eyes/_redact.sh",
];

function readManifest(): Manifest {
  return readManifestShared(process.cwd());
}
function writeManifest(m: Manifest) {
  mkdirSync(EYES_DIR, { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2));
}

function ensureGitignore() {
  const gi = resolve(process.cwd(), ".gitignore");
  const existing = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  const missing = GITIGNORE_ENTRIES.filter((e) => !existing.includes(e));
  if (missing.length) {
    const suffix =
      (existing.endsWith("\n") || !existing ? "" : "\n") +
      "\n# ggcoder-eyes\n" +
      missing.join("\n") +
      "\n";
    writeFileSync(gi, existing + suffix);
  }
}

function sh(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? process.cwd(),
    env: { ...process.env, EYES_PROJECT_ROOT: process.cwd(), ...(opts.env ?? {}) },
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  });
  return { stdout: r.stdout?.trim() ?? "", code: r.status ?? 1 };
}

function capabilityDirs(): string[] {
  return readdirSync(PROBES_DIR).filter((d) => {
    const p = join(PROBES_DIR, d);
    return existsSync(join(p, "install.sh"));
  });
}

function doInit() {
  mkdirSync(EYES_DIR, { recursive: true });
  mkdirSync(join(EYES_DIR, "out"), { recursive: true });
  mkdirSync(join(EYES_DIR, "state"), { recursive: true });
  mkdirSync(join(EYES_DIR, "bin"), { recursive: true });
  // Copy shared infra
  for (const f of ["_lib.sh", "_redact.sh"]) {
    const src = join(SHARED_DIR, f);
    const dst = join(EYES_DIR, f);
    writeFileSync(dst, readFileSync(src));
    sh("chmod", ["+x", dst]);
  }
  ensureGitignore();
  if (!existsSync(MANIFEST)) writeManifest({ version: 1, probes: [] });
  console.log(`initialized: ${EYES_DIR}`);
}

function doDetect() {
  const out: Record<string, { candidates: string[]; primary: string }> = {};
  for (const cap of capabilityDirs()) {
    const detect = join(PROBES_DIR, cap, "detect.sh");
    if (!existsSync(detect)) {
      // Universal capabilities without detect.sh (e.g. http) — single universal impl.
      out[cap] = { candidates: ["*"], primary: "*" };
      continue;
    }
    const r = sh("bash", [detect]);
    if (r.code === 0 && r.stdout) {
      try {
        out[cap] = JSON.parse(r.stdout);
      } catch {
        out[cap] = { candidates: [], primary: "" };
      }
    } else {
      out[cap] = { candidates: [], primary: "" };
    }
  }
  console.log(JSON.stringify(out, null, 2));
}

function doInstall(args: string[]) {
  const cap = args[0];
  if (!cap) {
    console.error("usage: ggcoder-eyes install <capability> [--impl <name>] [--as <script-name>]");
    process.exit(1);
  }
  let impl: string | undefined;
  let asName: string | undefined;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--impl") impl = args[++i];
    else if (args[i] === "--as") asName = args[++i];
  }

  const capDir = join(PROBES_DIR, cap);
  if (!existsSync(capDir)) {
    console.error(`unknown capability: ${cap}. known: ${capabilityDirs().join(", ")}`);
    process.exit(1);
  }

  // If no impl given, consult detect.sh
  if (!impl) {
    const detectPath = join(capDir, "detect.sh");
    if (existsSync(detectPath)) {
      const r = sh("bash", [detectPath]);
      try {
        impl = JSON.parse(r.stdout).primary;
      } catch {
        /* fall through */
      }
    } else {
      // Universal probe — pick the only impl
      const impls = readdirSync(join(capDir, "impl")).filter((f) => f.endsWith(".sh"));
      if (impls.length === 1) impl = impls[0].replace(/\.sh$/, "");
    }
  }
  if (!impl) {
    console.error(`could not auto-detect impl for ${cap}; pass --impl <name>`);
    process.exit(1);
  }

  // Ensure .gg/eyes exists + shared is present
  doInit();

  const installArgs = [join(capDir, "install.sh"), impl];
  if (asName) installArgs.push("--as", asName);
  // Capture stdout (for EYES_INSTALLED=<path> marker) but pass stderr through
  // so the user sees the install script's progress in real time.
  const r = spawnSync("bash", installArgs, {
    stdio: ["inherit", "pipe", "inherit"],
    encoding: "utf8",
    env: { ...process.env, EYES_PROJECT_ROOT: process.cwd() },
  });
  const stdout = typeof r.stdout === "string" ? r.stdout : "";
  if (r.status !== 0) {
    if (stdout) process.stdout.write(stdout);
    console.error(`install failed for ${cap}/${impl}`);
    process.exit(r.status ?? 1);
  }

  // Parse the authoritative install path from the script's own stdout. Falls
  // back to the computed default only if the script didn't emit one (older
  // probe versions). This is what fixed the bug where runtime_logs was written
  // to .gg/eyes/logs.sh but the manifest recorded .gg/eyes/runtime_logs.sh.
  const match = stdout.match(/^EYES_INSTALLED=(.+)$/m);
  const installedPath = match ? match[1].trim() : null;

  // Relay any non-marker stdout lines to the user
  const userVisibleStdout = stdout
    .split("\n")
    .filter((line) => !line.startsWith("EYES_INSTALLED="))
    .join("\n");
  if (userVisibleStdout.trim()) process.stdout.write(userVisibleStdout);

  // Record in manifest using the real install path + derived name
  const m = readManifest();
  let name: string;
  let script: string;
  if (installedPath) {
    name = installedPath.replace(/\.sh$/, "").split("/").pop() ?? cap;
    const cwd = process.cwd();
    script = installedPath.startsWith(cwd + "/")
      ? installedPath.slice(cwd.length + 1)
      : installedPath;
  } else {
    // Fallback for install scripts that didn't emit EYES_INSTALLED
    name = asName ?? cap;
    script = `.gg/eyes/${name}.sh`;
  }
  const existing = m.probes.findIndex((p) => p.name === name);
  const entry: ProbeEntry = { capability: cap, name, impl, script, status: "built" };
  if (existing >= 0) m.probes[existing] = entry;
  else m.probes.push(entry);
  writeManifest(m);

  console.log(`installed ${cap}/${impl} as ${script}`);
}

function doVerify(args: string[]) {
  const target = args[0];
  const m = readManifest();
  // Verify both `built` (never tested) and `failed` (retry) probes. Only
  // `verified` are skipped by default — they're known good, re-running is a
  // separate `verify <name>` call.
  const targets = target
    ? m.probes.filter((p) => p.name === target)
    : m.probes.filter((p) => p.status === "built" || p.status === "failed");
  if (!targets.length) {
    console.log("no probes to verify (all are verified — pass a name to re-verify one)");
    return;
  }
  for (const p of targets) {
    const testPath = join(PROBES_DIR, p.capability, "test.sh");
    if (!existsSync(testPath)) {
      console.log(`- ${p.name}: no test.sh, skipping`);
      continue;
    }
    const r = spawnSync("bash", [testPath, p.name], {
      stdio: "inherit",
      env: { ...process.env, EYES_PROJECT_ROOT: process.cwd() },
    });
    if (r.status === 0) {
      p.status = "verified";
      delete p.error;
      console.log(`✓ ${p.name}`);
    } else {
      p.status = "failed";
      p.error = `test.sh exit ${r.status}`;
      console.log(`✗ ${p.name} (exit ${r.status})`);
    }
  }
  writeManifest(m);
}

function doList() {
  const m = readManifest();
  if (!m.probes.length) {
    console.log("no probes installed. run: ggcoder-eyes detect | install <capability>");
    return;
  }
  for (const p of m.probes) {
    const flag = p.status === "verified" ? "✓" : p.status === "failed" ? "✗" : "·";
    console.log(
      `${flag} ${p.name.padEnd(20)} ${p.capability.padEnd(18)} ${p.impl.padEnd(12)} ${p.status}${p.error ? ` (${p.error})` : ""}`,
    );
  }
}

const LOG_KINDS: ReadonlySet<string> = new Set(["rough", "wish", "blocked"]);
const LOG_STATUSES: ReadonlySet<string> = new Set(["open", "deferred", "acked"]);

function doLog(args: string[]) {
  const sub = args[0];
  if (!sub) {
    console.error("usage: ggcoder-eyes log <rough|wish|blocked|ack|defer|list|count> ...");
    process.exit(1);
  }

  // Gate: non-eyes projects get silent no-ops for all log subcommands.
  // Reads return empty / zero; writes do nothing. Exit code is always 0 so
  // callers (probes, hooks) can invoke freely without branching on setup state.
  if (!isEyesActive(process.cwd())) {
    if (sub === "list") console.log("[]");
    else if (sub === "count") console.log("0");
    return;
  }

  if (LOG_KINDS.has(sub)) {
    const reason = args[1];
    if (!reason) {
      console.error(`usage: ggcoder-eyes log ${sub} "<reason>" [--probe <name>]`);
      process.exit(1);
    }
    let probe: string | undefined;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--probe") probe = args[++i];
    }
    const entry = appendEntry({ kind: sub as JournalKind, reason, probe });
    if (entry) console.log(entry.id);
    return;
  }

  if (sub === "ack" || sub === "defer") {
    const id = args[1];
    if (!id) {
      console.error(`usage: ggcoder-eyes log ${sub} <id>`);
      process.exit(1);
    }
    const ok = updateEntry(id, { status: sub === "ack" ? "acked" : "deferred" });
    if (!ok) {
      console.error(`no entry with id: ${id}`);
      process.exit(1);
    }
    console.log(`${sub}: ${id}`);
    return;
  }

  if (sub === "list" || sub === "count") {
    let status: JournalStatus | undefined;
    let kind: JournalKind | undefined;
    let limit: number | undefined;
    for (let i = 1; i < args.length; i++) {
      const flag = args[i];
      const val = args[++i];
      if (flag === "--status" && LOG_STATUSES.has(val)) status = val as JournalStatus;
      else if (flag === "--kind" && LOG_KINDS.has(val)) kind = val as JournalKind;
      else if (flag === "--limit") limit = Number(val);
    }
    if (sub === "count") {
      console.log(String(journalCount({ status, kind })));
    } else {
      const entries = readJournal({ status, kind, limit, order: "desc" });
      console.log(JSON.stringify(entries, null, 2));
    }
    return;
  }

  console.error(`unknown log subcommand: ${sub}`);
  process.exit(1);
}

const cmd = process.argv[2];
const args = process.argv.slice(3);

switch (cmd) {
  case "init":
    doInit();
    break;
  case "detect":
    doDetect();
    break;
  case "install":
    doInstall(args);
    break;
  case "verify":
    doVerify(args);
    break;
  case "list":
    doList();
    break;
  case "log":
    doLog(args);
    break;
  default:
    console.error(
      `usage: ggcoder-eyes <command>

commands:
  init                          create .gg/eyes/, copy shared infra, update .gitignore
  detect                        emit JSON of capability → {candidates, primary}
  install <cap> [--impl <name>] [--as <name>]
                                install deps + copy probe into .gg/eyes/
  verify [<name>]               run probe self-tests, update manifest
  list                          show installed probes and their status
  log <rough|wish|blocked> "<reason>" [--probe <name>]
                                append a journal entry (silent no-op if eyes not set up)
  log <ack|defer> <id>          change an entry's status
  log list [--status S] [--kind K] [--limit N]
                                emit JSON array of journal entries
  log count [--status S] [--kind K]
                                print count to stdout
`.trim(),
    );
    process.exit(cmd ? 1 : 0);
}
