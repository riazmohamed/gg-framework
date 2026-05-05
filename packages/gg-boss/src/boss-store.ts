import { useSyncExternalStore } from "react";
import type { ActivityPhase, RetryInfo } from "@abukhaled/ogcoder/ui";
import type {
  ContentPart,
  Message,
  Provider,
  TextContent,
  ToolCall,
  ToolResult,
} from "@abukhaled/gg-ai";
import type { WorkerStatus, WorkerTurnSummary } from "./types.js";

let nextId = 1;
const id = (): string => `i${nextId++}`;

function isText(p: ContentPart): p is TextContent {
  return p.type === "text";
}

function isToolCall(p: ContentPart): p is ToolCall {
  return p.type === "tool_call";
}

function userMessageText(
  content: string | ({ type: "text"; text: string } | { type: "image" })[],
): string {
  if (typeof content === "string") return content;
  return content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
}

function toolResultText(content: ToolResult["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("");
}

// ── History items (rendered in Ink Static) ─────────────────

export interface UserItem {
  kind: "user";
  id: string;
  text: string;
  timestamp: number;
}

export interface AssistantItem {
  kind: "assistant";
  id: string;
  text: string;
  durationMs: number;
  thinking?: string;
  thinkingMs?: number;
}

export interface ToolItem {
  kind: "tool";
  id: string;
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  isError: boolean;
  durationMs: number;
  result: string;
  details?: unknown;
}

export interface WorkerEventItem {
  kind: "worker_event";
  id: string;
  project: string;
  status: WorkerStatus;
  finalText: string;
  toolsUsed: { name: string; ok: boolean }[];
  turnIndex: number;
  timestamp: string;
}

export interface WorkerErrorItem {
  kind: "worker_error";
  id: string;
  project: string;
  message: string;
  timestamp: string;
}

export interface InfoItem {
  kind: "info";
  id: string;
  text: string;
  level?: "info" | "warning" | "error";
}

export type HistoryItem =
  | UserItem
  | AssistantItem
  | ToolItem
  | WorkerEventItem
  | WorkerErrorItem
  | InfoItem;

// ── Streaming (current boss turn, rendered live above the input) ────

export interface StreamingTool {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  startedAt: number;
  durationMs?: number;
  result?: string;
  details?: unknown;
}

export interface StreamingTurn {
  text: string;
  thinking: string;
  thinkingMs: number;
  tools: StreamingTool[];
  startedAt: number;
  thinkingStartedAt: number | null;
}

export interface CompactionSnapshot {
  state: "running" | "done";
  originalCount: number;
  newCount: number;
  tokensBefore: number;
  tokensAfter: number;
}

// ── Worker view state ──────────────────────────────────────

export interface WorkerView {
  name: string;
  cwd: string;
  status: WorkerStatus;
  lastSummary?: WorkerTurnSummary;
}

// ── Top-level state ────────────────────────────────────────

export interface BossUiState {
  bossProvider: Provider;
  bossModel: string;
  workerProvider: Provider;
  workerModel: string;
  /** Providers the user is logged in to — controls which models the picker offers. */
  loggedInProviders: Provider[];
  history: HistoryItem[];
  /**
   * Two-phase flush queue. Items here have already been REMOVED from the
   * streaming live-area (so it has shrunk) but not yet committed to history.
   * A useEffect in BossApp watches `flushGeneration` and calls
   * `commitPendingFlush()` on the next render cycle, so Ink's log-update
   * doesn't try to clear a tall live area AND write new Static lines in the
   * same frame — which clips the bottom of long responses.
   */
  pendingFlush: HistoryItem[];
  flushGeneration: number;
  streaming: StreamingTurn | null;
  phase: "idle" | "working";
  /** Fine-grained phase used by ActivityIndicator. */
  activityPhase: ActivityPhase;
  /** Most recent retry (provider overload, rate limit, etc.), null when not retrying. */
  retryInfo: RetryInfo | null;
  /** Live compaction status (or recent done-state) for the orchestrator's banner. */
  compaction: CompactionSnapshot | null;
  /** Cumulative input tokens from boss turn_end events. Drives footer context bar. */
  bossInputTokens: number;
  /** When the current boss turn started (for elapsed display). */
  runStartMs: number | null;
  workers: WorkerView[];
  pendingUserMessages: number; // queued while boss is busy
  exitPending: boolean;
  /**
   * Scope pill in the input — "all" (default) or a specific worker name.
   * Cycled with Tab; gets injected into every prompt the user sends.
   */
  scope: string;
}

const initialState: BossUiState = {
  bossProvider: "anthropic",
  bossModel: "",
  workerProvider: "anthropic",
  workerModel: "",
  loggedInProviders: [],
  history: [],
  pendingFlush: [],
  flushGeneration: 0,
  streaming: null,
  phase: "idle",
  activityPhase: "idle",
  retryInfo: null,
  compaction: null,
  bossInputTokens: 0,
  runStartMs: null,
  workers: [],
  pendingUserMessages: 0,
  exitPending: false,
  scope: "all",
};

let state: BossUiState = initialState;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function getSnapshot(): BossUiState {
  return state;
}

export function useBossState(): BossUiState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ── Mutations (called by orchestrator/worker) ──────────────

export const bossStore = {
  init(opts: {
    bossProvider: Provider;
    bossModel: string;
    workerProvider: Provider;
    workerModel: string;
    loggedInProviders: Provider[];
    workers: { name: string; cwd: string }[];
  }): void {
    state = {
      ...initialState,
      bossProvider: opts.bossProvider,
      bossModel: opts.bossModel,
      workerProvider: opts.workerProvider,
      workerModel: opts.workerModel,
      loggedInProviders: opts.loggedInProviders,
      workers: opts.workers.map((w) => ({ name: w.name, cwd: w.cwd, status: "idle" })),
    };
    notify();
  },

  setBossModel(provider: Provider, model: string): void {
    state = { ...state, bossProvider: provider, bossModel: model };
    notify();
  },

  setWorkerModel(provider: Provider, model: string): void {
    state = { ...state, workerProvider: provider, workerModel: model };
    notify();
  },

  setLoggedInProviders(providers: Provider[]): void {
    state = { ...state, loggedInProviders: providers };
    notify();
  },

  appendUser(text: string): void {
    state = {
      ...state,
      history: [...state.history, { kind: "user", id: id(), text, timestamp: Date.now() }],
    };
    notify();
  },

  appendInfo(text: string, level: InfoItem["level"] = "info"): void {
    state = {
      ...state,
      history: [...state.history, { kind: "info", id: id(), text, level }],
    };
    notify();
  },

  setPendingMessages(n: number): void {
    if (state.pendingUserMessages === n) return;
    state = { ...state, pendingUserMessages: n };
    notify();
  },

  startStreaming(): void {
    state = {
      ...state,
      phase: "working",
      activityPhase: "waiting",
      retryInfo: null,
      runStartMs: Date.now(),
      streaming: {
        text: "",
        thinking: "",
        thinkingMs: 0,
        tools: [],
        startedAt: Date.now(),
        thinkingStartedAt: null,
      },
    };
    notify();
  },

  appendStreamText(text: string): void {
    if (!state.streaming) return;
    // If we were thinking, stop the thinking timer and bank elapsed.
    const thinking = state.streaming.thinking;
    let thinkingMs = state.streaming.thinkingMs;
    let thinkingStartedAt = state.streaming.thinkingStartedAt;
    if (thinkingStartedAt != null) {
      thinkingMs += Date.now() - thinkingStartedAt;
      thinkingStartedAt = null;
    }
    state = {
      ...state,
      activityPhase: "generating",
      streaming: {
        ...state.streaming,
        text: state.streaming.text + text,
        thinking,
        thinkingMs,
        thinkingStartedAt,
      },
    };
    notify();
  },

  appendStreamThinking(text: string): void {
    if (!state.streaming) return;
    const startedAt = state.streaming.thinkingStartedAt ?? Date.now();
    state = {
      ...state,
      activityPhase: "thinking",
      streaming: {
        ...state.streaming,
        thinking: state.streaming.thinking + text,
        thinkingStartedAt: startedAt,
      },
    };
    notify();
  },

  setActivityPhase(phase: ActivityPhase): void {
    if (state.activityPhase === phase) return;
    state = { ...state, activityPhase: phase };
    notify();
  },

  setRetryInfo(info: RetryInfo | null): void {
    state = {
      ...state,
      retryInfo: info,
      activityPhase: info ? "retrying" : state.activityPhase,
    };
    notify();
  },

  startCompaction(): void {
    state = {
      ...state,
      compaction: {
        state: "running",
        originalCount: 0,
        newCount: 0,
        tokensBefore: state.bossInputTokens,
        tokensAfter: 0,
      },
    };
    notify();
  },

  endCompaction(originalCount: number, newCount: number): void {
    const before = state.compaction?.tokensBefore ?? state.bossInputTokens;
    state = {
      ...state,
      compaction: {
        state: "done",
        originalCount,
        newCount,
        tokensBefore: before,
        tokensAfter: state.bossInputTokens,
      },
    };
    notify();
  },

  cancelCompaction(): void {
    state = { ...state, compaction: null };
    notify();
  },

  /** Read-only accessor for the orchestrator (which lives outside React). */
  getInputTokens(): number {
    return state.bossInputTokens;
  },

  setBossInputTokens(tokens: number): void {
    if (state.bossInputTokens === tokens) return;
    state = { ...state, bossInputTokens: tokens };
    notify();
  },

  startTool(toolCallId: string, name: string, args: Record<string, unknown>): void {
    if (!state.streaming) return;
    const tool: StreamingTool = {
      toolCallId,
      name,
      args,
      status: "running",
      startedAt: Date.now(),
    };
    state = {
      ...state,
      streaming: { ...state.streaming, tools: [...state.streaming.tools, tool] },
    };
    notify();
  },

  endTool(
    toolCallId: string,
    isError: boolean,
    durationMs: number,
    result: string,
    details?: unknown,
  ): void {
    if (!state.streaming) return;
    const tool = state.streaming.tools.find((t) => t.toolCallId === toolCallId);
    const remaining = state.streaming.tools.filter((t) => t.toolCallId !== toolCallId);
    if (!tool) {
      notify();
      return;
    }
    const historyItem: HistoryItem = {
      kind: "tool",
      id: id(),
      toolCallId: tool.toolCallId,
      name: tool.name,
      args: tool.args,
      isError,
      durationMs,
      result,
      details,
    };
    // Phase 1: shrink the live area (remove from streaming.tools), queue the
    // committed tool for Static. Phase 2 happens in BossApp's useEffect.
    state = {
      ...state,
      streaming: { ...state.streaming, tools: remaining },
      pendingFlush: [...state.pendingFlush, historyItem],
      flushGeneration: state.flushGeneration + 1,
    };
    notify();
  },

  /**
   * Flush any pending streaming text into the pendingFlush queue. The actual
   * commit to history happens on the next render cycle (two-phase flush) so
   * Ink doesn't clip long responses.
   * Called on tool_call_start and turn_end so text/tool order is preserved.
   */
  flushPendingText(): void {
    if (!state.streaming) return;
    const text = state.streaming.text.trim();
    if (!text) return;
    const thinking = state.streaming.thinking.trim();
    const item: HistoryItem = {
      kind: "assistant",
      id: id(),
      text,
      durationMs: Date.now() - state.streaming.startedAt,
      thinking: thinking ? thinking : undefined,
      thinkingMs: thinking ? state.streaming.thinkingMs : undefined,
    };
    state = {
      ...state,
      streaming: {
        ...state.streaming,
        text: "",
        thinking: "",
        thinkingMs: 0,
        thinkingStartedAt: null,
        startedAt: Date.now(),
      },
      pendingFlush: [...state.pendingFlush, item],
      flushGeneration: state.flushGeneration + 1,
    };
    notify();
  },

  /**
   * Phase 2 of the two-phase flush. Move queued items into history. Called by
   * a useEffect in BossApp when flushGeneration changes — guaranteed to run
   * AFTER React has painted the live-area shrinkage from phase 1.
   */
  commitPendingFlush(): void {
    if (state.pendingFlush.length === 0) return;
    state = {
      ...state,
      history: [...state.history, ...state.pendingFlush],
      pendingFlush: [],
    };
    notify();
  },

  /**
   * Called when the user interrupts (ESC / Ctrl+C while running). Stops all
   * in-flight running tools, queueing them in pendingFlush as errored "Stopped."
   * entries — matches ggcoder's onAborted behavior so the user sees the same
   * visual feedback for an aborted run.
   */
  interruptStreaming(): void {
    if (!state.streaming) return;
    const stoppedItems: HistoryItem[] = [];
    const remainingTools: StreamingTool[] = [];
    for (const t of state.streaming.tools) {
      if (t.status === "running") {
        stoppedItems.push({
          kind: "tool",
          id: id(),
          toolCallId: t.toolCallId,
          name: t.name,
          args: t.args,
          isError: true,
          durationMs: 0,
          result: "Stopped.",
        });
      } else {
        remainingTools.push(t);
      }
    }
    if (stoppedItems.length === 0) return;
    state = {
      ...state,
      streaming: { ...state.streaming, tools: remainingTools },
      pendingFlush: [...state.pendingFlush, ...stoppedItems],
      flushGeneration: state.flushGeneration + 1,
    };
    notify();
  },

  /**
   * Tear down the streaming session. By this point, tool_call_end and turn_end
   * handlers have already flushed text + tools into pendingFlush in proper order.
   * Anything left is a final text tail (no tool followed it) — also goes through
   * the two-phase queue so it doesn't clip.
   */
  finishStreaming(): void {
    if (!state.streaming) {
      state = { ...state, phase: "idle" };
      notify();
      return;
    }
    const items: HistoryItem[] = [];
    const tail = state.streaming.text.trim();
    if (tail) {
      const thinking = state.streaming.thinking.trim();
      items.push({
        kind: "assistant",
        id: id(),
        text: tail,
        durationMs: Date.now() - state.streaming.startedAt,
        thinking: thinking ? thinking : undefined,
        thinkingMs: thinking ? state.streaming.thinkingMs : undefined,
      });
    }
    // Defensive: any running tools without a tool_call_end (shouldn't happen).
    for (const t of state.streaming.tools) {
      items.push({
        kind: "tool",
        id: id(),
        toolCallId: t.toolCallId,
        name: t.name,
        args: t.args,
        isError: t.status === "error",
        durationMs: t.durationMs ?? 0,
        result: t.result ?? "",
        details: t.details,
      });
    }
    state = {
      ...state,
      streaming: null,
      phase: "idle",
      activityPhase: "idle",
      retryInfo: null,
      runStartMs: null,
      pendingFlush: items.length > 0 ? [...state.pendingFlush, ...items] : state.pendingFlush,
      flushGeneration: items.length > 0 ? state.flushGeneration + 1 : state.flushGeneration,
    };
    notify();
  },

  setWorkerStatus(name: string, status: WorkerStatus): void {
    state = {
      ...state,
      workers: state.workers.map((w) => (w.name === name ? { ...w, status } : w)),
    };
    notify();
  },

  appendWorkerEvent(summary: WorkerTurnSummary): void {
    state = {
      ...state,
      history: [
        ...state.history,
        {
          kind: "worker_event",
          id: id(),
          project: summary.project,
          status: summary.status,
          finalText: summary.finalText,
          toolsUsed: summary.toolsUsed,
          turnIndex: summary.turnIndex,
          timestamp: summary.timestamp,
        },
      ],
      workers: state.workers.map((w) =>
        w.name === summary.project ? { ...w, status: summary.status, lastSummary: summary } : w,
      ),
    };
    notify();
  },

  appendWorkerError(project: string, message: string, timestamp: string): void {
    state = {
      ...state,
      history: [...state.history, { kind: "worker_error", id: id(), project, message, timestamp }],
      workers: state.workers.map((w) => (w.name === project ? { ...w, status: "error" } : w)),
    };
    notify();
  },

  setScope(scope: string): void {
    if (state.scope === scope) return;
    state = { ...state, scope };
    notify();
  },

  /** Cycle scope through ["all", ...worker names]. Wraps around. */
  cycleScope(): void {
    const names = ["all", ...state.workers.map((w) => w.name)];
    if (names.length === 0) return;
    const idx = names.indexOf(state.scope);
    const next = names[(idx + 1) % names.length] ?? "all";
    state = { ...state, scope: next };
    notify();
  },

  setExitPending(pending: boolean): void {
    if (state.exitPending === pending) return;
    state = { ...state, exitPending: pending };
    notify();
  },

  reset(): void {
    state = initialState;
    notify();
  },

  /**
   * Rebuild the visible chat history from a persisted Message[] (boss session
   * resume). Pairs assistant tool_use blocks with their tool_result blocks
   * so completed tools render in scrollback as if they'd just happened.
   */
  restoreHistory(messages: Message[]): void {
    const toolResults = new Map<string, ToolResult>();
    for (const m of messages) {
      if (m.role === "tool") {
        for (const tr of m.content) toolResults.set(tr.toolCallId, tr);
      }
    }

    const items: HistoryItem[] = [];
    for (const m of messages) {
      if (m.role === "user") {
        const text = userMessageText(m.content);
        if (!text) continue;
        // Strip the scope prefix the user never typed — only the boss sees it.
        const cleaned = text.replace(/^\[scope:[^\]]+\]\s*/, "");
        items.push({ kind: "user", id: id(), text: cleaned, timestamp: Date.now() });
      } else if (m.role === "assistant") {
        const parts = Array.isArray(m.content)
          ? m.content
          : [{ type: "text", text: m.content } as TextContent];
        let textBuf = "";
        for (const p of parts) {
          if (isText(p)) {
            textBuf += p.text;
          } else if (isToolCall(p)) {
            // Flush any preceding text as a single assistant block first.
            if (textBuf.trim()) {
              items.push({
                kind: "assistant",
                id: id(),
                text: textBuf.trim(),
                durationMs: 0,
              });
              textBuf = "";
            }
            const result = toolResults.get(p.id);
            const resultText = result ? toolResultText(result.content) : "";
            items.push({
              kind: "tool",
              id: id(),
              toolCallId: p.id,
              name: p.name,
              args: p.args,
              isError: result?.isError ?? false,
              durationMs: 0,
              result: resultText,
            });
          }
          // thinking / image / server_tool / raw — skipped for restore.
        }
        if (textBuf.trim()) {
          items.push({
            kind: "assistant",
            id: id(),
            text: textBuf.trim(),
            durationMs: 0,
          });
        }
      }
      // tool messages handled via the toolResults map above; skip.
    }

    state = { ...state, history: [...state.history, ...items] };
    notify();
  },

  /** /clear handler: wipe history but keep workers, model info, etc. */
  clearHistory(): void {
    state = {
      ...state,
      history: [],
      pendingFlush: [],
      flushGeneration: state.flushGeneration + 1,
      streaming: null,
      phase: "idle",
      activityPhase: "idle",
      retryInfo: null,
      compaction: null,
      bossInputTokens: 0,
      runStartMs: null,
    };
    notify();
  },
};
