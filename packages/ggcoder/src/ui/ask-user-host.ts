import {
  ASK_USER_INTERACTIVE_DEADLINE_MS,
  createAskUserBridge,
  formatLateAnswer,
  type AskUserBridge,
  type AskUserPrompt,
} from "../core/ask-user.js";

export interface OpenAskQuestion {
  prompt: AskUserPrompt;
  /** Soft deadline passed: the agent moved on, an answer goes in as a message. */
  deferred: boolean;
}

/**
 * The terminal app's side of `ask_user`: the same parked-request bridge the
 * desktop sidecar uses, plus the one open question for the UI to render.
 * Created once in `cli.ts`, so a question survives every Ink remount.
 */
export interface TuiAskUserHost {
  readonly bridge: AskUserBridge;
  current: () => OpenAskQuestion | null;
  subscribe: (listener: () => void) => () => void;
  answer: (answers: Record<string, string | string[]>) => void;
  dismiss: () => void;
  /** Run aborted or session reset: release and close everything. */
  cancelAll: () => void;
  /** Where a late answer goes; App sets this to queue or send a message. */
  onLateAnswer: ((text: string) => void) | null;
}

export function createTuiAskUserHost(
  deadlineMs: number = ASK_USER_INTERACTIVE_DEADLINE_MS,
): TuiAskUserHost {
  let open: OpenAskQuestion | null = null;
  const listeners = new Set<() => void>();
  const set = (next: OpenAskQuestion | null) => {
    open = next;
    for (const listener of listeners) listener();
  };

  const host: TuiAskUserHost = {
    bridge: createAskUserBridge({
      broadcast: (prompt) => set({ prompt, deferred: false }),
      timeoutMs: deadlineMs,
      onTimeout: (prompt) => {
        if (open?.prompt.id === prompt.id) set({ prompt, deferred: true });
      },
      onLateAnswer: (late) => host.onLateAnswer?.(formatLateAnswer(late)),
      onClosed: (ids) => {
        if (open && ids.includes(open.prompt.id)) set(null);
      },
    }),
    current: () => open,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    answer: (answers) => {
      if (!open) return;
      const { id } = open.prompt;
      set(null);
      host.bridge.settle(id, { action: "answer", answers });
    },
    dismiss: () => {
      if (!open) return;
      const { id } = open.prompt;
      set(null);
      host.bridge.settle(id, { action: "cancel" });
    },
    cancelAll: () => {
      host.bridge.cancelAll();
      set(null);
    },
    onLateAnswer: null,
  };
  return host;
}
