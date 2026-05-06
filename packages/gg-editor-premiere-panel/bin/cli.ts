#!/usr/bin/env node
import chalk from "chalk";
import {
  disableDebugMode,
  enableDebugMode,
  installCepPanel,
  installUxpPlugin,
  installedPanelDir,
  installedUxpPluginDir,
  isCepPanelInstalled,
  isUxpPluginInstalled,
  uninstallCepPanel,
  uninstallUxpPlugin,
} from "../src/installer.js";

/**
 * `gg-editor-premiere-panel` ships two panels:
 *
 *   - **UXP** (default) — Premiere Pro 25.6+. The only path that survives
 *     Adobe's September 2026 ExtendScript sunset.
 *   - **CEP** (`--cep`) — Legacy ExtendScript-backed panel. Works on Premiere
 *     22+, but Adobe is removing CEP support after Sept 2026.
 *
 * Both can coexist (different bundle ids); the gg-editor bridge prefers the
 * one that responds first.
 */

function printHelp(): void {
  process.stdout.write(`gg-editor-premiere-panel — install the gg-editor extension into Adobe Premiere Pro

USAGE
  gg-editor-premiere-panel install [--uxp|--cep]   Install the panel (UXP by default)
  gg-editor-premiere-panel uninstall [--uxp|--cep] Remove a panel (defaults to UXP)
  gg-editor-premiere-panel status                  Show install state for both panels
  gg-editor-premiere-panel debug-on                Enable PlayerDebugMode (CEP only)
  gg-editor-premiere-panel debug-off               Disable PlayerDebugMode (CEP only)

PANEL CHOICES
  --uxp   Modern UXP plugin. Requires Premiere Pro 25.6+.
          You must enable Premiere → Settings → Plugins → "Enable Developer Mode" once.
  --cep   Legacy CEP panel. Works through September 2026, then removed by Adobe.

After UXP install:
  1. Quit and restart Premiere Pro
  2. In Premiere: Settings → Plugins → check "Enable Developer Mode"
  3. Restart Premiere
  4. Window menu → UXP Plugins → "GG Editor"
  5. Click Connect — the panel dials gg-editor's WS server (default port 7437)
  6. Now run \`ggeditor --host premiere\`

After CEP install:
  1. Quit and restart Premiere Pro
  2. Window menu → Extensions → "GG Editor"
  3. The panel should show "listening" with a port (default 7437)
  4. Now run \`ggeditor --host premiere\`

The gg-editor CLI hosts a WebSocket server on 127.0.0.1 only — never beyond
localhost — that the UXP plugin connects to. (UXP plugins can't open listening
sockets, so the roles are flipped vs the CEP path where the panel is the server.)
`);
}

function status(): void {
  const cepInstalled = isCepPanelInstalled();
  const uxpInstalled = isUxpPluginInstalled();
  process.stdout.write(chalk.bold("UXP plugin (Premiere 25.6+, recommended)\n"));
  process.stdout.write(`  Path:      ${installedUxpPluginDir()}\n`);
  process.stdout.write(`  Installed: ${uxpInstalled ? chalk.green("yes") : chalk.red("no")}\n`);
  process.stdout.write("\n");
  process.stdout.write(chalk.bold("CEP panel (legacy, supported through Sept 2026)\n"));
  process.stdout.write(`  Path:      ${installedPanelDir()}\n`);
  process.stdout.write(`  Installed: ${cepInstalled ? chalk.green("yes") : chalk.red("no")}\n`);
}

type PanelChoice = "uxp" | "cep";

function pickChoice(args: string[], fallback: PanelChoice = "uxp"): PanelChoice {
  if (args.includes("--cep")) return "cep";
  if (args.includes("--uxp")) return "uxp";
  return fallback;
}

function doInstallUxp(): void {
  process.stdout.write(chalk.dim("Installing UXP plugin…\n"));
  const r = installUxpPlugin();
  process.stdout.write(`  Installed to: ${r.installedTo}\n`);
  process.stdout.write(`  Copied files: ${r.copiedFiles}\n\n`);

  process.stdout.write(chalk.bold("Next steps:\n"));
  process.stdout.write("  1. Quit and restart Premiere Pro\n");
  process.stdout.write("  2. Settings → Plugins → enable \"Enable Developer Mode\"\n");
  process.stdout.write("  3. Restart Premiere again (developer mode requires a restart)\n");
  process.stdout.write("  4. Window → UXP Plugins → \"GG Editor\"\n");
  process.stdout.write("  5. Click Connect, then run: ggeditor --host premiere\n");
}

function doInstallCep(): void {
  process.stdout.write(chalk.dim("Installing CEP panel…\n"));
  const r = installCepPanel();
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
  process.stdout.write(
    chalk.yellow(
      "\nNote: Adobe is removing CEP support in September 2026. " +
        "Consider --uxp if your Premiere is 25.6+.\n",
    ),
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (!cmd || cmd === "-h" || cmd === "--help") {
    printHelp();
    return;
  }

  if (cmd === "install") {
    const choice = pickChoice(argv);
    if (choice === "cep") doInstallCep();
    else doInstallUxp();
    return;
  }

  if (cmd === "uninstall") {
    const choice = pickChoice(argv);
    if (choice === "cep") {
      const r = uninstallCepPanel();
      if (r.removed) process.stdout.write(chalk.green(`Removed CEP: ${r.path}\n`));
      else process.stdout.write(chalk.dim(`CEP not installed: ${r.path}\n`));
    } else {
      const r = uninstallUxpPlugin();
      if (r.removed) process.stdout.write(chalk.green(`Removed UXP: ${r.path}\n`));
      else process.stdout.write(chalk.dim(`UXP not installed: ${r.path}\n`));
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
