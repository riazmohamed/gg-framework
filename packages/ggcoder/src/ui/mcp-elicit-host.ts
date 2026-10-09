import type { AskQuestion, AskUserPrompt } from "../core/ask-user.js";
import {
  createElicitationBridge,
  type ElicitationBridge,
  type ElicitationPrompt,
} from "../core/mcp/elicitation-bridge.js";
import { log } from "../core/logger.js";
import { answersToElicitContent, elicitationToQuestions } from "./mcp-elicit-form.js";

export interface OpenElicitation {
  request: ElicitationPrompt;
  /** The form as picker questions; a fresh object each time it is (re)shown. */
  prompt: AskUserPrompt;
  /** Why the last submission was refused (e.g. a number did not parse). */
  error?: string;
}

/**
 * The terminal's side of MCP elicitation: the sidecar's parked-request bridge,
 * with forms queued (two servers can ask at once) and shown one at a time.
 */
export interface TuiElicitHost {
  readonly bridge: ElicitationBridge;
  current: () => OpenElicitation | null;
  subscribe: (listener: () => void) => () => void;
  submit: (answers: Record<string, string | string[]>) => void;
  decline: () => void;
  cancelAll: () => void;
}

/** Key of the Accept/Decline question shown for a form with no fields. */
const CONFIRM_ID = "\u0000confirm";

function toPrompt(request: ElicitationPrompt): AskUserPrompt {
  const questions: AskQuestion[] = elicitationToQuestions(request.requestedSchema);
  if (questions.length === 0) {
    questions.push({
      id: CONFIRM_ID,
      question: "Allow this?",
      kind: "choice",
      allowOther: false,
      options: [
        { label: "Accept", value: "accept" },
        { label: "Decline", value: "decline" },
      ],
    });
  }
  return { id: request.id, questions };
}

export function createTuiElicitHost(timeoutMs?: number): TuiElicitHost {
  const queue: ElicitationPrompt[] = [];
  let open: OpenElicitation | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const showNext = () => {
    const next = queue[0];
    open = next ? { request: next, prompt: toPrompt(next) } : null;
    notify();
  };
  const finish = (id: string) => {
    const index = queue.findIndex((request) => request.id === id);
    if (index !== -1) queue.splice(index, 1);
    if (open?.request.id === id) showNext();
  };

  const host: TuiElicitHost = {
    bridge: createElicitationBridge({
      broadcast: (request) => {
        queue.push(request);
        if (!open) showNext();
      },
      onTimeout: (request) => {
        log("WARN", "mcp", "MCP elicitation timed out", { server: request.server });
        finish(request.id);
      },
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    }),
    current: () => open,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    submit: (answers) => {
      if (!open) return;
      const { request } = open;
      if (answers[CONFIRM_ID] === "decline") {
        host.decline();
        return;
      }
      const converted = answersToElicitContent(request.requestedSchema, answers);
      if ("error" in converted) {
        open = { request, prompt: toPrompt(request), error: converted.error };
        notify();
        return;
      }
      host.bridge.settle(request.id, { action: "accept", content: converted.content });
      finish(request.id);
    },
    decline: () => {
      if (!open) return;
      const { id } = open.request;
      host.bridge.settle(id, { action: "decline" });
      finish(id);
    },
    cancelAll: () => {
      host.bridge.cancelAll();
      queue.length = 0;
      showNext();
    },
  };
  return host;
}
