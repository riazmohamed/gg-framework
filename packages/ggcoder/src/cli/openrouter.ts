import chalk from "chalk";
import { ensureAppDirs } from "../config.js";
import { AuthStorage } from "../core/auth-storage.js";
import { initLogger, log, closeLogger } from "../core/logger.js";
import {
  CatalogSyncError,
  openRouterCatalogStatus,
  loadOpenRouterCatalog,
  resetOpenRouterCatalog,
  syncOpenRouterCatalog,
  type OpenRouterCatalogStatus,
  type OpenRouterSyncResult,
} from "../core/openrouter-catalog-store.js";
import { mcpColors as C } from "../ui/mcp.js";
import { CLI_VERSION } from "./shared.js";

const dim = chalk.hex(C.dim);
const bad = chalk.hex(C.bad);

/** Plain-text status lines (no colors, so tests read them directly). */
export function formatOpenRouterStatus(
  status: OpenRouterCatalogStatus | OpenRouterSyncResult,
): string[] {
  if (!status.synced) {
    return [
      `OpenRouter models: built-in list (${status.baseUrl})`,
      "Run `ogcoder openrouter sync` to list every tool-capable model this endpoint serves.",
    ];
  }
  const when = status.syncedAt ? new Date(status.syncedAt).toLocaleString() : "unknown time";
  const lines = [`OpenRouter models: ${status.count} synced from ${status.baseUrl} (${when})`];
  if ("skipped" in status && status.skipped > 0) {
    lines.push(`${status.skipped} skipped (no tool calling, or already built in).`);
  }
  return lines;
}

/**
 * `ogcoder openrouter [status|sync|reset]`: the terminal twin of the desktop
 * Providers page's OpenRouter "Sync models" control. The synced list is loaded
 * at every startup, so `/model` shows it.
 */
export async function runOpenRouter(): Promise<void> {
  const paths = await ensureAppDirs();
  initLogger(paths.logFile, { version: CLI_VERSION });
  const sub = process.argv[3];
  const auth = new AuthStorage(paths.authFile);
  try {
    await auth.load();
    if (!sub || sub === "status") {
      await loadOpenRouterCatalog(auth);
      print(await openRouterCatalogStatus(auth));
      return;
    }
    if (sub === "sync") {
      console.log(dim("Reading the endpoint's model list…"));
      try {
        const result = await syncOpenRouterCatalog(auth);
        log("INFO", "openrouter", "catalog synced", { count: String(result.count) });
        print(result);
      } catch (err) {
        const message =
          err instanceof CatalogSyncError || err instanceof Error ? err.message : String(err);
        process.stderr.write(bad(`Sync failed: ${message}`) + "\n");
        process.exit(1);
      }
      return;
    }
    if (sub === "reset") {
      print(await resetOpenRouterCatalog(auth));
      return;
    }
    if (sub === "help") {
      printOpenRouterHelp();
      return;
    }
    process.stderr.write(`Unknown openrouter subcommand: ${sub}\n`);
    printOpenRouterHelp();
    process.exit(1);
  } finally {
    closeLogger();
  }
}

function print(status: OpenRouterCatalogStatus | OpenRouterSyncResult): void {
  for (const line of formatOpenRouterStatus(status)) console.log(line);
}

function printOpenRouterHelp(): void {
  console.log("Usage: ogcoder openrouter [status|sync|reset]");
  console.log("  status   Show whether the model list is built in or synced (default)");
  console.log(
    "  sync     Fetch <baseUrl>/models with your OpenRouter key and keep the tool-capable ones",
  );
  console.log("  reset    Go back to the built-in OpenRouter list");
}
