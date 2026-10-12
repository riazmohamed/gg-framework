import type { Message } from "@abukhaled/gg-ai";
import { buildEnvDeltaMessage } from "../core/env-delta.js";

/**
 * How the TUI tells the model that `/add-dir` or `/remove-dir` changed the
 * workspace roots. Same rule as `AgentSession.refreshPromptForRoots`: before
 * the conversation starts the prompt is simply rebuilt, but mid-conversation
 * the roots sit in the Environment section, and rewriting it would invalidate
 * every cached message after it. A short hidden note is appended instead.
 *
 * Returns "rebuild" when the caller should rebuild the system prompt, and
 * "noted" or "unchanged" otherwise (the note, if any, is already appended).
 */
export function noteRootsChange(
  messages: Message[],
  before: readonly string[],
  after: readonly string[],
): "rebuild" | "noted" | "unchanged" {
  if (!messages.some((message) => message.role !== "system")) return "rebuild";
  const note = buildEnvDeltaMessage(
    { additionalRoots: [...before] },
    { additionalRoots: [...after] },
  );
  if (!note) return "unchanged";
  messages.push(note);
  return "noted";
}
