#!/usr/bin/env node
import chalk from "chalk";
import {
  disableDebugMode,
  enableDebugMode,
  installPanel,
  installedPanelDir,
  isPanelInstalled,
  uninstallPanel,
} from "../src/installer.js";

function printHelp(): void {
  process.stdout.write(`gg-editor-premiere-panel — installs the gg-editor CEP panel into Adobe Premiere Pro

USAGE
  gg-editor-premiere-panel install      Install the panel + enable debug mode (one-time setup)
  gg-editor-premiere-panel uninstall    Remove the panel
  gg-editor-premiere-panel status       Show install state
  gg-editor-premiere-panel debug-on     Enable PlayerDebugMode (so unsigned panels load)
  gg-editor-premiere-panel debug-off    Disable PlayerDebugMode

After install:
  1. Quit and restart Premiere Pro
  2. Window menu → Extensions → "GG Editor"
  3. The panel should show "listening" with a port (default 7437)
  4. Now run \`ggeditor --host premiere\` from the gg-editor CLI

The panel runs a local HTTP server on 127.0.0.1 only — never exposed beyond localhost.
`);
}

function status(): void {
  const installed = isPanelInstalled();
  process.stdout.write(`Panel directory: ${installedPanelDir()}\n`);
  process.stdout.write(`Installed:       ${installed ? chalk.green("yes") : chalk.red("no")}\n`);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];

  if (!cmd || cmd === "-h" || cmd === "--help") {
    printHelp();
    return;
  }

  if (cmd === "install") {
    process.stdout.write(chalk.dim("Installing panel…\n"));
    const r = installPanel();
    process.stdout.write(`  Installed to: ${r.installedTo}\n`);
    process.stdout.write(`  Copied files: ${r.copiedFiles}\n\n`);

    process.stdout.write(chalk.dim("Enabling PlayerDebugMode (required for unsigned panels)…\n"));
    const dm = enableDebugMode();
    for (const [v, ok] of Object.entries(dm.perVersion)) {
      process.stdout.write(`  CSXS.${v}: ${ok ? chalk.green("ok") : chalk.red("failed")}\n`);
    }
    if (dm.notes.length) {
      for (const n of dm.notes) process.stdout.write(chalk.dim(`  note: ${n}\n`));
    }

    process.stdout.write("\n" + chalk.bold("Next steps:\n"));
    process.stdout.write("  1. Quit and restart Premiere Pro\n");
    process.stdout.write("  2. Window → Extensions → \"GG Editor\"\n");
    process.stdout.write("  3. Run: ggeditor --host premiere\n");
    return;
  }

  if (cmd === "uninstall") {
    const r = uninstallPanel();
    if (r.removed) {
      process.stdout.write(chalk.green(`Removed: ${r.path}\n`));
    } else {
      process.stdout.write(chalk.dim(`Not installed: ${r.path}\n`));
    }
    return;
  }

  if (cmd === "status") {
    status();
    return;
  }

  if (cmd === "debug-on") {
    const r = enableDebugMode();
    for (const [v, ok] of Object.entries(r.perVersion)) {
      process.stdout.write(`  CSXS.${v}: ${ok ? chalk.green("ok") : chalk.red("failed")}\n`);
    }
    return;
  }

  if (cmd === "debug-off") {
    const r = disableDebugMode();
    for (const [v, ok] of Object.entries(r.perVersion)) {
      process.stdout.write(`  CSXS.${v}: ${ok ? chalk.green("ok") : chalk.red("failed")}\n`);
    }
    return;
  }

  process.stderr.write(chalk.red(`unknown command: ${cmd}\n`));
  printHelp();
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(chalk.red(`Fatal: ${(e as Error).message}\n`));
  process.exit(1);
});
