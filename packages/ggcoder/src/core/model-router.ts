import type { Message, Provider } from "@abukhaled/gg-ai";
import type { ModelRouterResult } from "@abukhaled/gg-agent";
import {
  getModel,
  getVisionModel,
  getVideoCapableModel,
  getDocumentCapableModel,
  getExecutorModel,
  type ModelInfo,
} from "./model-registry.js";

// ── Helpers ────────────────────────────────────────────────

function findLastUserMessage(messages: Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") return messages[i]!;
  }
  return undefined;
}

function messageHasImages(msg: Message): boolean {
  if (msg.role !== "user") return false;
  if (!Array.isArray(msg.content)) return false;
  return msg.content.some((c) => c.type === "image");
}

/** Check if any message in the conversation contains images. */
function conversationHasImages(messages: Message[]): boolean {
  return messages.some((m) => messageHasImages(m));
}

function messageHasVideo(msg: Message): boolean {
  if (msg.role !== "user") return false;
  if (!Array.isArray(msg.content)) return false;
  return msg.content.some((c) => c.type === "video");
}

/** Check if any message in the conversation contains video. */
function conversationHasVideo(messages: Message[]): boolean {
  return messages.some((m) => messageHasVideo(m));
}

function messageHasDocuments(msg: Message): boolean {
  if (msg.role !== "user") return false;
  if (!Array.isArray(msg.content)) return false;
  return msg.content.some((c) => c.type === "document");
}

/** Check if any message in the conversation contains documents. */
function conversationHasDocuments(messages: Message[]): boolean {
  return messages.some((m) => messageHasDocuments(m));
}

// ── Cross-Provider Fallback Context ───────────────────────────

/**
 * Per-provider credentials needed to hit its endpoint. Passed into the
 * vision router so it can transparently switch providers for a single
 * turn when the current provider has no vision-capable model (e.g. user
 * is on MiniMax, which silently drops images over the Anthropic-compat
 * endpoint, and falls back to Claude or GLM-4.6V for that turn).
 */
export interface ProviderCreds {
  apiKey: string;
  baseUrl?: string;
  accountId?: string;
}

export interface VisionRouterContext {
  /** Providers the user is logged into — candidates for cross-provider fallback. */
  loggedInProviders?: Provider[];
  /** Lookup table keyed by provider id. */
  providerCredentials?: Partial<Record<Provider, ProviderCreds>>;
}

type MediaKind = "image" | "video" | "document";

function capabilityFor(kind: MediaKind, provider: Provider): ModelInfo | undefined {
  if (kind === "image") return getVisionModel(provider);
  if (kind === "video") return getVideoCapableModel(provider);
  return getDocumentCapableModel(provider);
}

/**
 * Cross-provider preference order for vision fallback. Claude is intentionally
 * excluded: it's far more expensive than open-weight vision models, and for
 * coding workflows the user wants GLM-4.6V or MiMo Omni as their default
 * image scanner, not Opus/Sonnet. Users who want Claude for an image turn
 * can still switch manually with `/model`.
 */
const CROSS_PROVIDER_VISION_PREFERENCE: Provider[] = [
  "glm", // GLM-4.6V — cheap, vision-native
  "xiaomi", // MiMo V2 Omni — multimodal, high context
  "moonshot", // Kimi K2.5 — supports images
  "openai", // GPT-5.4 etc. — last resort
];

/**
 * Find the best media-capable model to route to for this turn.
 * 1. Prefer a model from the current provider (no credential switch).
 * 2. Otherwise walk CROSS_PROVIDER_VISION_PREFERENCE in order and pick
 *    the first logged-in provider with a capable model. Claude is
 *    deliberately absent from the fallback list.
 */
function findMediaOverride(
  kind: MediaKind,
  currentProvider: Provider,
  ctx: VisionRouterContext,
): ModelRouterResult | null {
  // 1. Same provider first — no credential switch needed.
  const sameProvider = capabilityFor(kind, currentProvider);
  if (sameProvider) {
    return {
      model: sameProvider.id,
      reason: `${kindLabel(kind)} detected — scanning with ${sameProvider.name}`,
    };
  }

  // 2. Cross-provider fallback in explicit preference order (Claude excluded).
  const loggedIn = new Set(ctx.loggedInProviders ?? []);
  for (const candidateProvider of CROSS_PROVIDER_VISION_PREFERENCE) {
    if (candidateProvider === currentProvider) continue;
    if (!loggedIn.has(candidateProvider)) continue;
    const creds = ctx.providerCredentials?.[candidateProvider];
    if (!creds) continue;
    const model = capabilityFor(kind, candidateProvider);
    if (!model) continue;
    return {
      provider: candidateProvider,
      model: model.id,
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
      reason: `${kindLabel(kind)} detected — scanning with ${model.name} via ${candidateProvider}`,
    };
  }
  return null;
}

function kindLabel(kind: MediaKind): string {
  if (kind === "image") return "Image";
  if (kind === "video") return "Video";
  return "Document";
}

// ── Router Mode ────────────────────────────────────────────

export type RouterMode = "off" | "vision" | "plan-execute" | "hybrid";

// ── Vision Router ──────────────────────────────────────────

/**
 * Per-turn router that switches to a media-capable model when the latest
 * user message contains images, video, or documents that the current
 * model cannot handle. When the follow-up turn has no new media, the
 * router returns null and agent-loop reverts to the default model/provider
 * passed in `options` — no explicit snap-back is needed.
 *
 * Falls back to a different logged-in provider's vision model if the
 * current provider has none (e.g. MiniMax → Claude/GLM-4.6V).
 */
export function createVisionRouter(ctx: VisionRouterContext = {}) {
  return (
    messages: Message[],
    currentModel: string,
    currentProvider: string,
  ): ModelRouterResult | null => {
    const lastUserMsg = findLastUserMessage(messages);
    if (!lastUserMsg) return null;

    const hasImages = messageHasImages(lastUserMsg);
    const hasVideo = messageHasVideo(lastUserMsg);
    const hasDocuments = messageHasDocuments(lastUserMsg);
    const currentModelInfo = getModel(currentModel);

    if (hasImages && !currentModelInfo?.supportsImages) {
      const override = findMediaOverride("image", currentProvider as Provider, ctx);
      if (override) return override;
    }

    if (hasVideo && !currentModelInfo?.supportsVideo) {
      const override = findMediaOverride("video", currentProvider as Provider, ctx);
      if (override) return override;
    }

    if (hasDocuments && !currentModelInfo?.supportsDocuments) {
      const override = findMediaOverride("document", currentProvider as Provider, ctx);
      if (override) return override;
    }

    // No media in the latest turn → return null so agent-loop uses the
    // caller's default provider/model/apiKey/baseUrl.
    return null;
  };
}

// ── Plan-Execute Router ────────────────────────────────────

/**
 * Routes new user inputs to the planner model (heavier, better reasoning)
 * and tool follow-up turns to the executor model (lighter, faster).
 */
export function createPlanExecuteRouter(plannerModel: string, executorModel: string) {
  return (
    messages: Message[],
    currentModel: string,
    _currentProvider: string,
  ): ModelRouterResult | null => {
    const lastMsg = messages[messages.length - 1];

    // After tool results → executor for the follow-up turn
    if (lastMsg?.role === "tool") {
      if (currentModel !== executorModel) {
        return { model: executorModel, reason: `Tool follow-up — using ${executorModel}` };
      }
      return null;
    }

    // New user message → planner for reasoning
    if (lastMsg?.role === "user") {
      if (currentModel !== plannerModel) {
        return { model: plannerModel, reason: `New task — using ${plannerModel}` };
      }
    }

    return null;
  };
}

// ── Hybrid Router ──────────────────────────────────────────

export interface HybridRouterConfig {
  plannerModel: string;
  executorModel: string;
  visionContext?: VisionRouterContext;
}

/**
 * Full hybrid router: vision takes priority (images must be handled by
 * a vision model), then plan-execute routing for text-only turns.
 */
export function createHybridRouter(config: HybridRouterConfig) {
  const visionRouter = createVisionRouter(config.visionContext);
  const planExecRouter = createPlanExecuteRouter(config.plannerModel, config.executorModel);

  return (
    messages: Message[],
    currentModel: string,
    currentProvider: string,
  ): ModelRouterResult | null => {
    // Vision routing takes priority — images must be handled by a vision model
    const visionResult = visionRouter(messages, currentModel, currentProvider);
    if (visionResult) return visionResult;

    // If images, video, or documents exist anywhere in the conversation, stay on the vision model
    // to avoid switching to a text-only model that can't handle multimodal context
    if (
      conversationHasImages(messages) ||
      conversationHasVideo(messages) ||
      conversationHasDocuments(messages)
    ) {
      return null;
    }

    // Then plan-execute routing for text-only turns
    return planExecRouter(messages, currentModel, currentProvider);
  };
}

// ── Router Factory ─────────────────────────────────────────

/**
 * Create a model router based on the specified mode and provider capabilities.
 * Returns undefined if routing is not needed (mode "off").
 *
 * When `visionContext` is supplied, the vision router can fall back to
 * another logged-in provider (e.g. MiniMax → Claude) for multimodal turns.
 */
export function createModelRouter(
  mode: RouterMode,
  provider: Provider,
  currentModel: string,
  visionContext?: VisionRouterContext,
):
  | ((
      messages: Message[],
      currentModel: string,
      currentProvider: string,
    ) => ModelRouterResult | null)
  | undefined {
  if (mode === "off") return undefined;

  if (mode === "vision") {
    return createVisionRouter(visionContext);
  }

  const executorModel = getExecutorModel(provider, currentModel);

  if (mode === "plan-execute") {
    return createPlanExecuteRouter(currentModel, executorModel.id);
  }

  // hybrid
  return createHybridRouter({
    plannerModel: currentModel,
    executorModel: executorModel.id,
    visionContext,
  });
}
