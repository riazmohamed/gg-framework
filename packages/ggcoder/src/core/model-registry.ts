// Moved to @abukhaled/gg-core. This shim re-exports it so existing relative
// imports (`./model-registry.js`) and the `@abukhaled/ogcoder/models` subpath
// export keep resolving unchanged.
export * from "@abukhaled/gg-core/models";

import type { Provider } from "@abukhaled/gg-ai";
import { getFastModel, getModelsForProvider, type ModelInfo } from "@abukhaled/gg-core/models";

// Capability-routing helpers used by the fork-only `core/model-router.ts`
// (vision / plan-execute / hybrid routing). gg-core owns the model data but
// does not ship these selectors, so they live here on top of its registry.

const TIER_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

function byTierDescending(models: ModelInfo[]): ModelInfo[] {
  return [...models].sort((a, b) => (TIER_RANK[b.costTier] ?? 0) - (TIER_RANK[a.costTier] ?? 0));
}

/**
 * Best vision-capable model for a provider — the highest `costTier` model
 * that reports `supportsImages`.
 */
export function getVisionModel(provider: Provider): ModelInfo | undefined {
  return byTierDescending(getModelsForProvider(provider).filter((m) => m.supportsImages))[0];
}

/**
 * Best video-capable model for a provider — the highest `costTier` model
 * that reports `supportsVideo`.
 */
export function getVideoCapableModel(provider: Provider): ModelInfo | undefined {
  return byTierDescending(getModelsForProvider(provider).filter((m) => m.supportsVideo))[0];
}

/**
 * Best document-capable model for a provider.
 *
 * gg-core's `ModelInfo` has no `supportsDocuments` flag: documents/PDFs are
 * delivered as image blocks over the same multimodal path, so image support is
 * the real capability gate. Hence this mirrors `getVisionModel`.
 */
export function getDocumentCapableModel(provider: Provider): ModelInfo | undefined {
  return getVisionModel(provider);
}

/**
 * Lighter executor model for plan-execute routing. gg-core's `getFastModel`
 * is the equivalent selector (cheapest sibling, falls back to the current
 * model when the provider has no cheaper tier).
 */
export function getExecutorModel(provider: Provider, currentModelId: string): ModelInfo {
  return getFastModel(provider, currentModelId);
}
