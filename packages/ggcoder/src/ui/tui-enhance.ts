import type { Provider, ThinkingLevel } from "@abukhaled/gg-ai";
import type { AuthStorage } from "../core/auth-storage.js";
import { getClaudeCliUserAgent } from "../core/claude-code-version.js";
import { detectProjectStack } from "../core/language-detector.js";
import { getAuthStorageKeys } from "../core/model-registry.js";
import type { SlashCommand } from "../core/slash-commands.js";
import { enhancePrompt, type EnhanceResult } from "../utils/prompt-enhancer.js";

export interface EnhanceRoute {
  provider: Provider;
  model: string;
  thinking?: ThinkingLevel;
  maxTokens: number;
  baseUrl?: string;
  cwd: string;
  authStorage?: AuthStorage;
}

export interface EnhanceDeps {
  route: () => EnhanceRoute;
  /** Put the rewrite in the input box, for the user to edit or send. */
  putInComposer: (text: string) => void;
  enhance?: typeof enhancePrompt;
}

/** The corrected terms, as the desktop shows them under the rewrite. */
export function describeEnhancement(result: EnhanceResult): string {
  const terms = result.segments.flatMap((segment) =>
    segment.kind === "term" && segment.original !== segment.text
      ? [`  ${segment.original} → ${segment.text}${segment.note ? ` (${segment.note})` : ""}`]
      : [],
  );
  // The composer collapses a multi-line injection to a paste placeholder, so
  // the rewrite is shown here in full as well.
  const lines = [
    "Rewritten prompt (now in the input box; press Enter to send it):",
    "",
    ...result.enhanced.split("\n").map((line) => `  ${line}`),
  ];
  if (terms.length > 0) lines.push("", "Terms:", ...terms);
  return lines.join("\n");
}

/** `/enhance <draft>`: rewrite a draft prompt faithfully, then hand it back. */
export function createEnhanceCommand(deps: EnhanceDeps): SlashCommand {
  return {
    name: "enhance",
    aliases: [],
    description: "Rewrite a draft prompt into a clearer request",
    usage: "/enhance <draft prompt>",
    async execute(args) {
      const draft = args.trim();
      if (!draft) return "Usage: /enhance <draft prompt>";
      const route = deps.route();
      if (!route.authStorage) return "The prompt enhancer needs a logged-in session.";
      let stack = "";
      try {
        stack = detectProjectStack(route.cwd);
      } catch {
        // Best-effort: no stack hint.
      }
      try {
        const creds = await route.authStorage.resolveCredentials(route.provider, {
          storageKeys: getAuthStorageKeys(route.provider, route.model),
        });
        const result = await (deps.enhance ?? enhancePrompt)({
          provider: route.provider,
          model: route.model,
          thinking: route.thinking,
          maxTokens: route.maxTokens,
          userAgent: route.provider === "anthropic" ? await getClaudeCliUserAgent() : undefined,
          projectId: creds.projectId,
          prompt: draft,
          stack,
          apiKey: creds.accessToken,
          baseUrl: route.baseUrl ?? creds.baseUrl,
          accountId: creds.accountId,
        });
        deps.putInComposer(result.enhanced);
        return describeEnhancement(result);
      } catch (error) {
        return `Could not enhance the prompt: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}
