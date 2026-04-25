import type { StreamOptions } from "./types.js";
import { GGAIError, ProviderError } from "./errors.js";
import type { StreamResult } from "./utils/event-stream.js";
import { streamAnthropic } from "./providers/anthropic.js";
import { streamOpenAI } from "./providers/openai.js";
import { streamOpenAICodex } from "./providers/openai-codex.js";
import { providerRegistry } from "./provider-registry.js";

/** Z.AI coding API endpoint — the primary endpoint for all GLM models. */
const GLM_CODING_BASE_URL = "https://api.z.ai/api/coding/paas/v4";

// ── Register built-in providers ────────────────────────────

providerRegistry.register("anthropic", {
  stream: (options) => streamAnthropic(options),
});

providerRegistry.register("xiaomi", {
  stream: (options) => {
    // Xiaomi issues region-scoped keys (ams, sgp, ...). A key from one region
    // returns 401 on another region's endpoint. Fail fast with a clear message
    // if baseUrl is missing rather than silently defaulting to a region that
    // may not match the user's key.
    if (!options.baseUrl) {
      throw new ProviderError(
        "xiaomi",
        'Missing baseUrl — Xiaomi keys are region-specific. Run "ogcoder login" and select the region matching your key.',
      );
    }
    return streamOpenAI({
      ...options,
      webSearch: false,
    });
  },
});

providerRegistry.register("openai", {
  stream: (options) => {
    // Use codex endpoint for OAuth tokens (have accountId)
    if (options.accountId) {
      return streamOpenAICodex(options);
    }
    return streamOpenAI(options);
  },
});

providerRegistry.register("glm", {
  stream: (options) => {
    if (options.baseUrl) return streamOpenAI(options);
    // Always use GLM coding plan endpoint for yearly plan access
    const codingApiKey = options.glmCodingApiKey || options.apiKey;
    return streamOpenAI({
      ...options,
      apiKey: codingApiKey,
      baseUrl: GLM_CODING_BASE_URL,
    });
  },
});

providerRegistry.register("moonshot", {
  stream: (options) =>
    streamOpenAI({
      ...options,
      baseUrl: options.baseUrl ?? "https://api.moonshot.ai/v1",
    }),
});

providerRegistry.register("ollama", {
  stream: (options) =>
    streamOpenAI({
      ...options,
      apiKey: options.apiKey ?? "ollama",
      baseUrl: options.baseUrl ?? "http://localhost:11434/v1",
    }),
});

providerRegistry.register("deepseek", {
  stream: (options) =>
    streamOpenAI({
      ...options,
      baseUrl: options.baseUrl ?? "https://api.deepseek.com/v1",
    }),
});

providerRegistry.register("openrouter", {
  stream: (options) =>
    streamOpenAI({
      ...options,
      baseUrl: options.baseUrl ?? "https://openrouter.ai/api/v1",
    }),
});

providerRegistry.register("minimax", {
  stream: (options) =>
    streamAnthropic({
      ...options,
      baseUrl: options.baseUrl ?? "https://api.minimax.io/anthropic",
      // MiniMax's Anthropic-compatible API does not support Anthropic-specific
      // server tools (web_search), context_management, or server-side tools.
      webSearch: false,
      compaction: false,
      clearToolUses: false,
      serverTools: undefined,
      // Strip image/video/document content blocks — MiniMax's Anthropic-compat
      // endpoint silently drops multimodal content and the model then reports
      // it "can't see" the image. Vision on MiniMax is only exposed through a
      // separate Image Understanding MCP server, not this chat endpoint.
      messages: options.messages.map((m) => {
        if (m.role !== "user" || !Array.isArray(m.content)) return m;
        const filtered = m.content.filter(
          (p) => p.type !== "image" && p.type !== "video" && p.type !== "document",
        );
        const dropped = m.content.length - filtered.length;
        if (dropped === 0) return m;
        return {
          ...m,
          content: [
            ...filtered,
            {
              type: "text" as const,
              text: `[${dropped} attachment(s) removed — MiniMax's Anthropic-compatible endpoint does not support image/video/document input. Switch to a vision-capable model (e.g. Claude, GLM-4.6V, or MiMo) to analyze attachments.]`,
            },
          ],
        };
      }),
    }),
});

// ── Public API ─────────────────────────────────────────────

/**
 * Unified streaming entry point. Returns a StreamResult that is both
 * an async iterable (for streaming events) and thenable (await for
 * the final response).
 *
 * Providers are resolved via the provider registry. Built-in providers
 * (anthropic, openai, glm, moonshot) are registered at module load.
 * Extensions can register custom providers via `providerRegistry.register()`.
 *
 * ```ts
 * // Stream events
 * for await (const event of stream({ provider: "anthropic", model: "claude-sonnet-4-6", messages })) {
 *   if (event.type === "text_delta") process.stdout.write(event.text);
 * }
 *
 * // Or just await the final message
 * const response = await stream({ provider: "openai", model: "gpt-4.1", messages });
 * ```
 */
export function stream(options: StreamOptions): StreamResult {
  const entry = providerRegistry.get(options.provider);
  if (!entry) {
    throw new GGAIError(
      `Unknown provider: "${options.provider}". Registered: ${providerRegistry.list().join(", ")}`,
    );
  }
  return entry.stream(options);
}
