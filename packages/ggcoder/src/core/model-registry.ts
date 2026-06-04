// Moved to @abukhaled/gg-core. This shim re-exports it so existing relative
// imports (`./model-registry.js`) and the `@abukhaled/ogcoder/models` subpath
// export keep resolving unchanged.
export * from "@abukhaled/gg-core/models";

// ── Vision-router model selection helpers (windows fork) ────────────
// Used by core/model-router.ts to pick per-turn vision / video / document /
// executor models. Kept here (not gg-core) because the router is fork-specific.
import { getDefaultModel, getModelsForProvider, type ModelInfo } from "@abukhaled/gg-core/models";
import type { Provider } from "@abukhaled/gg-ai";

const TIER_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

/**
 * Get the best vision-capable model for a provider.
 * Prefers the most capable (highest costTier) vision model, with smart fallback.
 * For GLM: prefer GLM-4.6V, which is always available on coding plans.
 */
export function getVisionModel(provider: Provider): ModelInfo | undefined {
  const visionModels = getModelsForProvider(provider).filter((m) => m.supportsImages);
  const sorted = visionModels.sort(
    (a, b) => (TIER_RANK[b.costTier] ?? 0) - (TIER_RANK[a.costTier] ?? 0),
  );

  // For GLM, if GLM-5V-Turbo is available but might not be provisioned,
  // return GLM-4.6V as the primary (which is always available on coding plans).
  // GLM-5V-Turbo can be tried via fallback logic elsewhere.
  if (provider === "glm") {
    return sorted.find((m) => m.id === "glm-4.6v");
  }

  return sorted[0];
}

/**
 * Get the best video-capable model for a provider.
 * Prefers the most capable (highest costTier) video model.
 */
export function getVideoCapableModel(provider: Provider): ModelInfo | undefined {
  const videoModels = getModelsForProvider(provider).filter((m) => m.supportsVideo);
  return videoModels.sort((a, b) => (TIER_RANK[b.costTier] ?? 0) - (TIER_RANK[a.costTier] ?? 0))[0];
}

/**
 * Get the best document-capable model for a provider.
 * Prefers the most capable (highest costTier) document model.
 */
export function getDocumentCapableModel(provider: Provider): ModelInfo | undefined {
  const documentModels = getModelsForProvider(provider).filter((m) => m.supportsDocuments);
  return documentModels.sort(
    (a, b) => (TIER_RANK[b.costTier] ?? 0) - (TIER_RANK[a.costTier] ?? 0),
  )[0];
}

/**
 * Get a capable executor model for a provider (lighter than the current model).
 * Prefers models with thinking support, picking a medium-tier model first.
 */
export function getExecutorModel(provider: Provider, currentModelId: string): ModelInfo {
  const models = getModelsForProvider(provider).filter(
    (m) => m.id !== currentModelId && m.supportsThinking,
  );
  return (
    models.find((m) => m.costTier === "medium") ??
    models.find((m) => m.costTier === "low") ??
    getDefaultModel(provider)
  );
}
