import type { Message, Provider } from "@abukhaled/gg-ai";
import type { ModelRouterResult } from "@abukhaled/gg-agent";
import {
  getModel,
  getVisionModel,
  getVideoCapableModel,
  getDocumentCapableModel,
  getExecutorModel,
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

// ── Router Mode ────────────────────────────────────────────

export type RouterMode = "off" | "vision" | "plan-execute" | "hybrid";

// ── Vision Router ──────────────────────────────────────────

/**
 * Auto-switches to a vision-capable model when images are detected
 * in the latest user message. Switches back to the default model
 * when no images are present.
 */
export function createVisionRouter(defaultModel: string, _defaultProvider: string) {
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
      const visionModel = getVisionModel(currentProvider as Provider);
      if (visionModel) {
        return {
          model: visionModel.id,
          reason: `Image detected — scanning with ${visionModel.name}`,
        };
      }
    }

    if (hasVideo && !currentModelInfo?.supportsVideo) {
      const videoModel = getVideoCapableModel(currentProvider as Provider);
      if (videoModel) {
        return {
          model: videoModel.id,
          reason: `Video detected — routing to ${videoModel.name}`,
        };
      }
    }

    if (hasDocuments && !currentModelInfo?.supportsDocuments) {
      const documentModel = getDocumentCapableModel(currentProvider as Provider);
      if (documentModel) {
        return {
          model: documentModel.id,
          reason: `Document detected — routing to ${documentModel.name}`,
        };
      }
    }

    // Switch back only when no rich media anywhere in the conversation
    const hasAnyMedia =
      conversationHasImages(messages) ||
      conversationHasVideo(messages) ||
      conversationHasDocuments(messages);

    if (!hasAnyMedia && currentModel !== defaultModel) {
      return { model: defaultModel, reason: `Returning to ${defaultModel}` };
    }

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
  visionModel: string;
  provider: string;
}

/**
 * Full hybrid router: vision takes priority (images must be handled by
 * a vision model), then plan-execute routing for text-only turns.
 */
export function createHybridRouter(config: HybridRouterConfig) {
  const visionRouter = createVisionRouter(config.plannerModel, config.provider);
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
 * Returns undefined if routing is not needed (mode "off" or provider has no
 * vision models and the current model already supports images).
 */
export function createModelRouter(
  mode: RouterMode,
  provider: Provider,
  currentModel: string,
):
  | ((
      messages: Message[],
      currentModel: string,
      currentProvider: string,
    ) => ModelRouterResult | null)
  | undefined {
  if (mode === "off") return undefined;

  const visionModel = getVisionModel(provider);
  const executorModel = getExecutorModel(provider, currentModel);

  if (mode === "vision") {
    if (!visionModel) return undefined;
    return createVisionRouter(currentModel, provider);
  }

  if (mode === "plan-execute") {
    return createPlanExecuteRouter(currentModel, executorModel.id);
  }

  // hybrid
  return createHybridRouter({
    plannerModel: currentModel,
    executorModel: executorModel.id,
    visionModel: visionModel?.id ?? currentModel,
    provider,
  });
}
