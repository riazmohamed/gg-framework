import type { Provider } from "@abukhaled/gg-ai";
import { outputCapForRequest } from "../core/agent-session.js";
import { getModel } from "../core/model-registry.js";

/**
 * Output-token cap for a TUI request, matching what `AgentSession` sends for
 * the desktop app: the active model's own `maxOutputTokens`, trimmed to the
 * room its compaction trigger leaves in the window. The TUI used to send a
 * flat 16K, so long replies and big writes kept hitting the limit on models
 * that allow 128K. `fallback` covers models missing from the registry.
 */
export function tuiOutputCap(options: {
  provider: Provider;
  model: string;
  fallback: number;
  threshold?: number;
  accountId?: string;
}): number {
  return outputCapForRequest({
    provider: options.provider,
    model: options.model,
    maxTokens: getModel(options.model)?.maxOutputTokens ?? options.fallback,
    threshold: options.threshold ?? 0.85,
    accountId: options.accountId,
  });
}
