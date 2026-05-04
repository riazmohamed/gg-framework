#!/usr/bin/env node
import path from "node:path";
import chalk from "chalk";
import type { Provider } from "@kenkaiiii/gg-ai";
import { GGBoss } from "./orchestrator.js";
import type { ProjectSpec } from "./types.js";
import { loadLinks } from "./links.js";
import { runLinkCommand } from "./link-command.js";
import { COLORS, clearScreen } from "./branding.js";
import { renderBossApp } from "./orchestrator-app.js";

interface CliArgs {
  bossProvider: Provider;
  bossModel: string;
  workerProvider: Provider;
  workerModel: string;
  projects: ProjectSpec[];
}

function parseProjectSpec(raw: string): ProjectSpec {
  const eq = raw.indexOf("=");
  if (eq > 0) {
    const name = raw.slice(0, eq);
    const cwd = path.resolve(raw.slice(eq + 1));
    return { name, cwd };
  }
  const cwd = path.resolve(raw);
  return { name: path.basename(cwd), cwd };
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    bossProvider: "anthropic",
    bossModel: "claude-opus-4-7",
    workerProvider: "anthropic",
    workerModel: "claude-sonnet-4-6",
    projects: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--project" || a === "-p") {
      const v = argv[++i];
      if (!v) throw new Error("--project requires a value");
      args.projects.push(parseProjectSpec(v));
    } else if (a === "--boss-model") {
      const v = argv[++i];
      if (!v) throw new Error("--boss-model requires a value");
      args.bossModel = v;
    } else if (a === "--worker-model") {
      const v = argv[++i];
      if (!v) throw new Error("--worker-model requires a value");
      args.workerModel = v;
    } else if (a === "--help" || a === "-h") {
      printHelpAndExit();
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }

  return args;
}

function printHelpAndExit(): never {
  const c = (color: string, text: string): string => chalk.hex(color)(text);
  process.stdout.write(
    "\n" +
      c(COLORS.primary, "GG Boss") +
      c(COLORS.textDim, " — orchestrator that drives multiple ggcoder workers from one chat.\n\n") +
      c(COLORS.text, "Usage\n") +
      "  " +
      c(COLORS.accent, "ggboss") +
      c(
        COLORS.textDim,
        "                              start orchestrator using linked projects\n",
      ) +
      "  " +
      c(COLORS.accent, "ggboss link") +
      c(COLORS.textDim, "                         pick which projects to link (interactive)\n") +
      "  " +
      c(COLORS.accent, "ggboss --project <spec> [...]") +
      c(COLORS.textDim, "       override links with explicit project(s)\n\n") +
      c(COLORS.text, "Options\n") +
      "  " +
      c(COLORS.primary, "--project, -p <spec>") +
      c(COLORS.textDim, '    project to manage. spec is "cwd" or "name=cwd". repeatable.\n') +
      "  " +
      c(COLORS.primary, "--boss-model <id>") +
      c(COLORS.textDim, "       model for the orchestrator (default: claude-opus-4-7)\n") +
      "  " +
      c(COLORS.primary, "--worker-model <id>") +
      c(COLORS.textDim, "     model for workers (default: claude-sonnet-4-6)\n") +
      "  " +
      c(COLORS.primary, "--help, -h") +
      c(COLORS.textDim, "              show this help\n\n") +
      c(COLORS.textDim, "Talk to the boss at the prompt. Press ") +
      c(COLORS.accent, "Ctrl+C") +
      c(COLORS.textDim, " twice to exit.\n\n"),
  );
  process.exit(0);
}

async function runOrchestrator(args: CliArgs): Promise<void> {
  if (args.projects.length === 0) {
    const links = await loadLinks();
    if (links.projects.length === 0) {
      process.stderr.write(
        "\n" +
          chalk.hex(COLORS.warning)("No linked projects.") +
          chalk.hex(COLORS.textDim)(" Run ") +
          chalk.hex(COLORS.accent)("ggboss link") +
          chalk.hex(COLORS.textDim)(" to choose, or pass ") +
          chalk.hex(COLORS.accent)("--project") +
          chalk.hex(COLORS.textDim)(".\n\n"),
      );
      process.exit(1);
    }
    args.projects = links.projects.map((p) => ({ name: p.name, cwd: p.cwd }));
  }

  clearScreen();
  process.stdout.write(
    chalk.hex(COLORS.textDim)("  Initializing ") +
      chalk.hex(COLORS.primary)("GG Boss") +
      chalk.hex(COLORS.textDim)(
        `…\n  Spinning up ${args.projects.length} worker${args.projects.length === 1 ? "" : "s"}.\n`,
      ),
  );

  const boss = new GGBoss({
    bossProvider: args.bossProvider,
    bossModel: args.bossModel,
    workerProvider: args.workerProvider,
    workerModel: args.workerModel,
    projects: args.projects,
  });

  await boss.initialize();

  clearScreen();

  const ink = renderBossApp({ boss });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    ink.unmount();
    await boss.dispose();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  // Run boss in background; await Ink unmount.
  const runPromise = boss.run();
  await ink.waitUntilExit();
  await boss.dispose();
  await runPromise.catch(() => {});
  process.exit(0);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv[0] === "link") {
    await runLinkCommand();
    process.exit(0);
  }

  const args = parseArgs(argv);
  await runOrchestrator(args);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(chalk.hex(COLORS.error)(`\ngg-boss failed: ${message}\n`));
  process.exit(1);
});
