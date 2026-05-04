import chalk from "chalk";
import {
  AUTHOR,
  BRAND,
  COLORS,
  GRADIENT,
  LOGO_GAP,
  LOGO_LINES,
  VERSION,
  clearScreen,
} from "./branding.js";

function gradientText(text: string): string {
  let result = "";
  let colorIdx = 0;
  for (const ch of text) {
    if (ch === " ") {
      result += ch;
    } else {
      const color = GRADIENT[colorIdx % GRADIENT.length]!;
      result += chalk.hex(color)(ch);
      colorIdx++;
    }
  }
  return result;
}

export interface BootBannerOptions {
  subtitle: string;
  bossModel: string;
  workerModel: string;
}

/** Print the GG Boss boot banner to stdout. Clears screen first. */
export function printBootBanner(opts: BootBannerOptions): void {
  clearScreen();
  process.stdout.write("\n");
  process.stdout.write(
    `  ${gradientText(LOGO_LINES[0]!)}${LOGO_GAP}` +
      chalk.hex(COLORS.primary).bold(BRAND) +
      chalk.hex(COLORS.textDim)(` v${VERSION}`) +
      chalk.hex(COLORS.textDim)(" · By ") +
      chalk.hex(COLORS.text).bold(AUTHOR) +
      "\n",
  );
  process.stdout.write(
    `  ${gradientText(LOGO_LINES[1]!)}${LOGO_GAP}` + chalk.hex(COLORS.accent)(opts.subtitle) + "\n",
  );
  process.stdout.write(
    `  ${gradientText(LOGO_LINES[2]!)}${LOGO_GAP}` +
      chalk.hex(COLORS.textDim)(`Boss ${opts.bossModel}  ·  Workers ${opts.workerModel}`) +
      "\n",
  );
  process.stdout.write("\n");
}

/** Print the project list under the banner. */
export function printProjectList(projects: { name: string; cwd: string }[]): void {
  for (const p of projects) {
    const home = process.env.HOME ?? "";
    const display = home && p.cwd.startsWith(home) ? "~" + p.cwd.slice(home.length) : p.cwd;
    process.stdout.write(
      "  " +
        chalk.hex(COLORS.primary)(p.name.padEnd(20)) +
        chalk.hex(COLORS.textDim)(display) +
        "\n",
    );
  }
  process.stdout.write("\n");
}

export function printReady(workerCount: number): void {
  process.stdout.write(
    chalk.hex(COLORS.success)("  Ready. ") +
      chalk.hex(COLORS.textDim)(
        `${workerCount} worker${workerCount === 1 ? "" : "s"} initialized.`,
      ) +
      "\n",
  );
  process.stdout.write("\n");
  process.stdout.write(
    chalk.hex(COLORS.textDim)("  :quit  ") +
      chalk.hex(COLORS.textDim)("exit") +
      chalk.hex(COLORS.textDim)("     Ctrl+C  ") +
      chalk.hex(COLORS.textDim)("interrupt") +
      "\n",
  );
  process.stdout.write("\n");
}

export function printShutdown(): void {
  process.stdout.write("\n" + chalk.hex(COLORS.textDim)("Shutting down...") + "\n");
}
