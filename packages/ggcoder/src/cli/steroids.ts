import chalk from "chalk";
import { ensureAppDirs } from "../config.js";
import { initLogger, log, closeLogger } from "../core/logger.js";
import { installSteroids, probeSteroids, type SteroidsStatus } from "../core/steroids.js";
import { mcpColors as C } from "../ui/mcp.js";
import { CLI_VERSION } from "./shared.js";

const dim = chalk.hex(C.dim);
const good = chalk.hex(C.good);
const bad = chalk.hex(C.bad);

/** `ogcoder steroids [install]` — the terminal twin of the desktop app's Steroids modal. */
export async function runSteroids(): Promise<void> {
  const paths = await ensureAppDirs();
  initLogger(paths.logFile, { version: CLI_VERSION });
  const sub = process.argv[3];
  try {
    if (!sub || sub === "status") {
      printStatus(await probeSteroids({ force: true }));
      return;
    }
    if (sub === "install" || sub === "update") {
      console.log(dim("Downloading the latest Agent Steroids release and checking its checksum…"));
      let status: SteroidsStatus;
      try {
        status = await installSteroids();
      } catch (err) {
        process.stderr.write(
          bad(`Install failed: ${err instanceof Error ? err.message : String(err)}`) + "\n",
        );
        process.exit(1);
      }
      log("INFO", "steroids", "steroids installed", { version: status.version });
      printStatus(status);
      console.log(dim("Restart ogcoder to give the agent the steroids tool."));
      return;
    }
    if (sub === "help") {
      printSteroidsHelp();
      return;
    }
    process.stderr.write(`Unknown steroids subcommand: ${sub}\n`);
    printSteroidsHelp();
    process.exit(1);
  } finally {
    closeLogger();
  }
}

/** Plain-text status lines (no colors, so tests read them directly). */
export function formatSteroidsStatus(status: SteroidsStatus): string[] {
  if (!status.installed) {
    return ["Agent Steroids is not installed.", "Install it with: ogcoder steroids install"];
  }
  const lines = [
    `Agent Steroids ${status.version ?? "(unknown version)"}${status.path ? ` at ${status.path}` : ""}`,
  ];
  if (status.error) {
    lines.push(`It did not run: ${status.error}`, "Reinstall with: ogcoder steroids install");
  } else if (status.connected) {
    lines.push(`Corpus: ${status.repos ?? 0} repos, ${status.documents ?? 0} documents.`);
  } else {
    lines.push("The corpus is empty. Run /steroids inside ogcoder to add repos.");
  }
  return lines;
}

function printStatus(status: SteroidsStatus): void {
  const [first, ...rest] = formatSteroidsStatus(status);
  const ok = status.installed && !status.error;
  console.log((ok ? good("● ") : bad("○ ")) + first);
  for (const line of rest) console.log(dim(line));
}

function printSteroidsHelp(): void {
  console.log(`ogcoder steroids — Agent Steroids, a local corpus of real GitHub repos

Usage:
  ogcoder steroids            Show whether it is installed and how big the corpus is
  ogcoder steroids install    Download the latest release (checksum-verified)

Inside ogcoder, /steroids builds the corpus for your project.`);
}
