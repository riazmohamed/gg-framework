import { OPENCODE_PROVIDERS, type OpenCodeProvider } from "@abukhaled/gg-core";
import type { AuthStorage } from "./auth-storage.js";
import { log } from "./logger.js";
import { openCodeCatalogs, type OpenCodeCatalogStore } from "./opencode-catalog-store.js";

/**
 * CLI startup for OpenCode's live model lists (the desktop sidecar does the
 * same on boot and on `/models`). Installs the cached lists, then refreshes a
 * connected plan's stale list in the background. Never throws: a failure keeps
 * the built-in rows.
 */
export async function loadOpenCodeCatalogs(
  auth: Pick<AuthStorage, "hasProviderAuth">,
  store: OpenCodeCatalogStore = openCodeCatalogs,
): Promise<void> {
  try {
    await store.load();
    const connected: OpenCodeProvider[] = [];
    for (const provider of OPENCODE_PROVIDERS) {
      if (await auth.hasProviderAuth(provider)) connected.push(provider);
    }
    if (connected.length > 0) void store.refreshStale(connected);
  } catch (err) {
    log("WARN", "opencode", "opencode catalog load failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
