import { describe, expect, it, vi } from "vitest";
import type { OpenCodeCatalogStore } from "./opencode-catalog-store.js";
import { loadOpenCodeCatalogs } from "./opencode-startup.js";

function fakeStore(overrides: Partial<OpenCodeCatalogStore> = {}): OpenCodeCatalogStore {
  return {
    load: vi.fn(async () => true),
    refreshStale: vi.fn(async () => false),
    ...overrides,
  };
}

describe("loadOpenCodeCatalogs", () => {
  it("installs the cached lists and refreshes only connected plans", async () => {
    const store = fakeStore();
    const auth = { hasProviderAuth: vi.fn(async (p: string) => p === "opencode-go") };
    await loadOpenCodeCatalogs(auth as never, store);
    expect(store.load).toHaveBeenCalledOnce();
    expect(store.refreshStale).toHaveBeenCalledWith(["opencode-go"]);
  });

  it("skips the refresh when no OpenCode plan is connected", async () => {
    const store = fakeStore();
    await loadOpenCodeCatalogs({ hasProviderAuth: async () => false } as never, store);
    expect(store.refreshStale).not.toHaveBeenCalled();
  });

  it("never throws when the cache can't be read", async () => {
    const store = fakeStore({ load: vi.fn(async () => Promise.reject(new Error("disk"))) });
    await expect(
      loadOpenCodeCatalogs({ hasProviderAuth: async () => true } as never, store),
    ).resolves.toBeUndefined();
  });
});
