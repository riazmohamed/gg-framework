import type { Provider, ThinkingLevel } from "@abukhaled/gg-ai";

export interface ModelInfo {
  id: string;
  name: string;
  provider: Provider;
  contextWindow: number;
  /**
   * ChatGPT Codex transport uses product-specific windows that can differ from
   * the public API model window. OpenAI OAuth requests include an accountId and
   * route through `/codex/responses`; API-key requests do not.
   */
  codexContextWindow?: number;
  maxOutputTokens: number;
  supportsThinking: boolean;
  supportsImages: boolean;
  supportsVideo?: boolean;
  supportsDocuments?: boolean;
  /**
   * Max video payload (bytes) this model's transport accepts, used to decide
   * when an attached/read video must be compressed before sending. Differs by
   * provider delivery mechanism:
   *   - Moonshot/Kimi: 100 MB (file-service upload cap)
   *   - MiniMax: 50 MB (Anthropic-compatible base64 inline cap)
   *   - Gemini: 20 MB (inlineData per-request cap)
   * Only meaningful when `supportsVideo` is true.
   */
  maxVideoBytes?: number;
  costTier: "low" | "medium" | "high";
  /**
   * The top reasoning tier this model genuinely uses. Used when thinking is
   * enabled to pick the strongest setting per model:
   *   - OpenAI GPT-5.5-era: `xhigh`
   *   - OpenAI Pro/Codex/old: clamped to what the model accepts
   *   - Claude Opus 4.8 / 4.7 / 4.6 and Sonnet 4.6: `max`
   *   - Claude Haiku 4.5: `high` (no adaptive `max` tier)
   *   - GLM / Moonshot / Xiaomi / MiniMax / Qwen: `high` — binary-thinking
   *     providers ignore the level on the wire, so the value is cosmetic
   *   - DeepSeek V4: `xhigh` (DeepSeek maps `xhigh` → its internal `max`)
   */
  maxThinkingLevel: ThinkingLevel;
}

// Provider display order — mirrors `PROVIDERS` in ui/login.tsx so the
// /model selector and login selector sort models identically.
export const MODELS: ModelInfo[] = [
  // ── Anthropic ──────────────────────────────────────────
  {
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8",
    provider: "anthropic",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportsImages: true,
    supportsVideo: false,
    costTier: "high",
    maxThinkingLevel: "max",
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    provider: "anthropic",
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    supportsThinking: true,
    supportsImages: true,
    supportsVideo: false,
    costTier: "medium",
    maxThinkingLevel: "max",
  },
  {
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsThinking: true,
    supportsImages: true,
    supportsVideo: false,
    costTier: "low",
    maxThinkingLevel: "high",
  },
  // ── OpenAI (Codex) ─────────────────────────────────────
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    provider: "openai",
    contextWindow: 1_050_000,
    codexContextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportsImages: true,
    supportsVideo: false,
    costTier: "high",
    maxThinkingLevel: "xhigh",
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    provider: "openai",
    contextWindow: 1_050_000,
    codexContextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportsImages: true,
    supportsVideo: false,
    costTier: "high",
    maxThinkingLevel: "xhigh",
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    provider: "openai",
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportsImages: true,
    supportsVideo: false,
    costTier: "low",
    maxThinkingLevel: "xhigh",
  },
  {
    id: "gpt-5.3-codex",
    name: "GPT-5.3 Codex",
    provider: "openai",
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportsImages: true,
    supportsVideo: false,
    costTier: "high",
    maxThinkingLevel: "xhigh",
  },
  // ── Gemini ─────────────────────────────────────────────
  {
    id: "gemini-3.1-flash-lite-preview",
    name: "Gemini 3.1 Flash Lite Preview",
    provider: "gemini",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsThinking: true,
    supportsImages: true,
    supportsVideo: true,
    maxVideoBytes: 20 * 1024 * 1024,
    costTier: "low",
    maxThinkingLevel: "high",
  },
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    provider: "gemini",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsThinking: true,
    supportsImages: true,
    supportsVideo: true,
    maxVideoBytes: 20 * 1024 * 1024,
    costTier: "low",
    maxThinkingLevel: "high",
  },
  // ── Moonshot (Kimi) ────────────────────────────────────
  {
    id: "kimi-k2.6",
    name: "Kimi K2.6",
    provider: "moonshot",
    contextWindow: 262_144,
    maxOutputTokens: 262_144,
    supportsThinking: true,
    supportsImages: true,
    supportsVideo: true,
    maxVideoBytes: 100 * 1024 * 1024,
    costTier: "medium",
    maxThinkingLevel: "high",
  },
  // ── Z.AI (GLM) ─────────────────────────────────────────
  {
    id: "glm-5.1",
    name: "GLM-5.1",
    provider: "glm",
    contextWindow: 204_800,
    maxOutputTokens: 131_072,
    supportsThinking: true,
    supportsImages: false,
    supportsVideo: false,
    costTier: "medium",
    maxThinkingLevel: "high",
  },
  {
    id: "glm-4.7",
    name: "GLM-4.7",
    provider: "glm",
    contextWindow: 200_000,
    maxOutputTokens: 131_072,
    supportsThinking: true,
    supportsImages: false,
    supportsVideo: false,
    costTier: "low",
    maxThinkingLevel: "high",
  },
  {
    id: "glm-4.7-flash",
    name: "GLM-4.7 Flash",
    provider: "glm",
    contextWindow: 200_000,
    maxOutputTokens: 131_072,
    supportsThinking: true,
    supportsImages: false,
    supportsVideo: false,
    costTier: "low",
    maxThinkingLevel: "high",
  },
  // ── GLM (Z.AI) — Vision ───────────────────────────────────
  {
    id: "glm-4.6v",
    name: "GLM-4.6V",
    provider: "glm",
    contextWindow: 128_000,
    maxOutputTokens: 32_768,
    supportsThinking: true,
    supportsImages: true,
    supportsVideo: true,
    supportsDocuments: true,
    costTier: "high",
    maxThinkingLevel: "high",
  },
  {
    id: "glm-5v-turbo",
    name: "GLM-5V Turbo",
    provider: "glm",
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportsImages: true,
    supportsVideo: true,
    supportsDocuments: true,
    costTier: "medium",
    maxThinkingLevel: "high",
  },
  {
    id: "glm-4.6v-flashx",
    name: "GLM-4.6V FlashX",
    provider: "glm",
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsThinking: true,
    supportsImages: true,
    costTier: "low",
    maxThinkingLevel: "high",
  },
  {
    id: "glm-4.6v-flash",
    name: "GLM-4.6V Flash",
    provider: "glm",
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsThinking: false,
    supportsImages: true,
    costTier: "low",
    maxThinkingLevel: "low",
  },
  // ── MiniMax ───────────────────────────────────────────────
  {
    id: "MiniMax-M3",
    name: "MiniMax M3",
    provider: "minimax",
    contextWindow: 1_000_000,
    maxOutputTokens: 131_072,
    supportsThinking: true,
    supportsImages: true,
    supportsVideo: true,
    maxVideoBytes: 50 * 1024 * 1024,
    costTier: "medium",
    maxThinkingLevel: "high",
  },
  // ── DeepSeek ───────────────────────────────────────────
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    provider: "deepseek",
    contextWindow: 1_048_576,
    maxOutputTokens: 384_000,
    supportsThinking: true,
    supportsImages: false,
    supportsVideo: false,
    costTier: "high",
    // DeepSeek V4 maps `xhigh` → its internal `max` tier.
    maxThinkingLevel: "xhigh",
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    provider: "deepseek",
    contextWindow: 1_048_576,
    maxOutputTokens: 384_000,
    supportsThinking: true,
    supportsImages: false,
    supportsVideo: false,
    costTier: "low",
    maxThinkingLevel: "xhigh",
  },
  // ── OpenRouter ─────────────────────────────────────────
  {
    id: "qwen/qwen3.6-plus",
    name: "Qwen3.6-Plus",
    provider: "openrouter",
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    supportsThinking: true,
    supportsImages: false,
    supportsVideo: false,
    costTier: "medium",
    maxThinkingLevel: "high",
  },
  // ── Xiaomi MiMo ────────────────────────────────────────
  // Note: MiMo V2 Pro is text-only in practice — even though Xiaomi markets
  // it as multimodal, the endpoint we hit doesn't accept image content. The
  // vision router will auto-switch to mimo-v2-omni for image/video/document
  // turns and snap back to pro afterward.
  {
    id: "mimo-v2-pro",
    name: "MiMo V2 Pro",
    provider: "xiaomi",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportsImages: false,
    supportsVideo: false,
    supportsDocuments: false,
    costTier: "high",
    maxThinkingLevel: "high",
  },
  {
    id: "mimo-v2-omni",
    name: "MiMo V2 Omni",
    provider: "xiaomi",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportsImages: true,
    supportsVideo: true,
    supportsDocuments: true,
    costTier: "high",
    maxThinkingLevel: "high",
  },
  {
    id: "mimo-v2-flash",
    name: "MiMo V2 Flash",
    provider: "xiaomi",
    contextWindow: 500_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportsImages: true,
    supportsVideo: true,
    supportsDocuments: true,
    costTier: "low",
    maxThinkingLevel: "high",
  },
];

export function getModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

export function getModelsForProvider(provider: Provider): ModelInfo[] {
  return MODELS.filter((m) => m.provider === provider);
}

export function getDefaultModel(provider: Provider): ModelInfo {
  if (provider === "xiaomi") return MODELS.find((m) => m.id === "mimo-v2-pro")!;
  if (provider === "openai") return MODELS.find((m) => m.id === "gpt-5.5")!;
  if (provider === "gemini") return MODELS.find((m) => m.id === "gemini-3.1-flash-lite-preview")!;
  if (provider === "glm") return MODELS.find((m) => m.id === "glm-5.1")!;
  if (provider === "moonshot") return MODELS.find((m) => m.id === "kimi-k2.6")!;
  if (provider === "minimax") return MODELS.find((m) => m.id === "MiniMax-M3")!;
  if (provider === "deepseek") return MODELS.find((m) => m.id === "deepseek-v4-pro")!;
  if (provider === "openrouter") return MODELS.find((m) => m.id === "qwen/qwen3.6-plus")!;
  return MODELS.find((m) => m.id === "claude-sonnet-4-6")!;
}

/** Default video payload cap (bytes) when a video model doesn't declare one. */
export const DEFAULT_MAX_VIDEO_BYTES = 20 * 1024 * 1024;

/**
 * Max video payload (bytes) the given model's transport accepts before the clip
 * must be compressed. Returns `undefined` for models without video support, so
 * callers can skip the native-video path entirely.
 */
export function getVideoByteLimit(modelId: string): number | undefined {
  const model = getModel(modelId);
  if (!model?.supportsVideo) return undefined;
  return model.maxVideoBytes ?? DEFAULT_MAX_VIDEO_BYTES;
}

export interface ContextWindowOptions {
  provider?: Provider;
  accountId?: string;
}

export function usesOpenAICodexTransport(options?: ContextWindowOptions): boolean {
  return options?.provider === "openai" && Boolean(options.accountId);
}

export function getContextWindow(modelId: string, options?: ContextWindowOptions): number {
  const model = getModel(modelId);
  if (!model) return 200_000;
  if (usesOpenAICodexTransport(options) && model.codexContextWindow) {
    return model.codexContextWindow;
  }
  return model.contextWindow;
}

const TIER_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

/**
 * Get the best vision-capable model for a provider.
 * Prefers the most capable (highest costTier) vision model, with smart fallback.
 * For GLM: prefer GLM-5V-Turbo (high-end) but falls back to GLM-4.6V if not provisioned.
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

/**
 * The strongest thinking level the given model genuinely uses. Falls back to
 * `"high"` for unknown models since every provider we ship accepts it.
 */
export function getMaxThinkingLevel(modelId: string): ThinkingLevel {
  return getModel(modelId)?.maxThinkingLevel ?? "high";
}

/**
 * Get the model to use for compaction summarization.
 * - Anthropic: always Sonnet 4.6
 * - OpenAI: cheapest (Codex Mini)
 * - Gemini: use the current model
 * - GLM: GLM-4.7 Flash (cheap alternative)
 * - Moonshot: use the current model (no cheap alternative)
 */
export function getSummaryModel(provider: Provider, currentModelId: string): ModelInfo {
  if (provider === "anthropic") {
    return MODELS.find((m) => m.id === "claude-sonnet-4-6")!;
  }
  if (
    provider === "openai" ||
    provider === "glm" ||
    provider === "ollama" ||
    provider === "xiaomi" ||
    provider === "deepseek"
  ) {
    const low = getModelsForProvider(provider).find((m) => m.costTier === "low");
    if (low) return low;
  }
  // Moonshot or fallback: use current model
  return getModel(currentModelId) ?? getDefaultModel(provider);
}
