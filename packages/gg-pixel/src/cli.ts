import { install, DEFAULT_INGEST_URL } from "./install.js";

interface ParsedArgs {
  command: string;
  ingestUrl?: string;
  name?: string;
  skipPackageInstall: boolean;
  help: boolean;
}

function parse(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { command: argv[0] ?? "", skipPackageInstall: false, help: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ingest-url") out.ingestUrl = argv[++i];
    else if (a === "--name") out.name = argv[++i];
    else if (a === "--skip-install") out.skipPackageInstall = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function printUsage(): void {
  console.log(`gg-pixel install — drop the pixel into the current project

Usage:
  gg-pixel install [--name <project-name>] [--ingest-url <url>] [--skip-install]

Options:
  --name           Project name to register (defaults to package.json name)
  --ingest-url     Backend URL (defaults to ${DEFAULT_INGEST_URL})
  --skip-install   Skip the package-manager install step (useful for testing)
`);
}

async function main(argv: string[]): Promise<void> {
  const args = parse(argv);
  if (args.help || !args.command) {
    printUsage();
    return;
  }
  if (args.command !== "install") {
    console.error(`Unknown command: ${args.command}`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  const result = await install({
    ingestUrl: args.ingestUrl,
    projectName: args.name,
    skipPackageInstall: args.skipPackageInstall,
  });

  console.log("");
  console.log(result.reused ? "Pixel re-wired (existing project)." : "Pixel installed.");
  console.log(`  Project:       ${result.projectName} (${result.projectId})`);
  console.log(`  Kind:          ${result.projectKind}`);
  console.log(`  Wrote:         ${result.initFilePath}`);
  console.log(`  Wrote env:     ${result.envFilePath}`);
  console.log(`  Mapping saved: ${result.projectsJsonPath}`);
  switch (result.entryWiring.kind) {
    case "injected":
      console.log(`  Wired entry:   ${result.entryWiring.entryPath}`);
      break;
    case "already_present":
      console.log(`  Entry:         ${result.entryWiring.entryPath} (already wired)`);
      break;
    case "no_entry_found":
      console.log(`  ⚠  Could not auto-detect your entry file.`);
      console.log(`     Add this line to the TOP of your entry file manually:`);
      console.log(`       import "./gg-pixel.init.mjs";`);
      break;
    case "skipped":
      console.log(`  ⚠  Entry wiring skipped: ${result.entryWiring.reason}`);
      break;
  }
  if (!result.packageInstalled && !args.skipPackageInstall) {
    console.log(`  ⚠  Package install failed via ${result.packageManager}. Run it manually.`);
  }
  if (result.secondaryInit) {
    console.log(`  Also wrote:    ${result.secondaryInit.path}`);
    console.log(`                 ${result.secondaryInit.description}`);
  }
  for (const w of result.warnings) {
    console.log(`  ⚠  ${w}`);
  }
  console.log("");
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
