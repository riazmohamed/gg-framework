import { useSyncExternalStore } from "react";
import type { WorkerStatus, WorkerTurnSummary } from "./types.js";

let nextId = 1;
const id = (): string => `i${nextId++}`;

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
  tools: StreamingTool[];
  startedAt: number;
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
  bossModel: string;
  workerModel: string;
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
  workers: WorkerView[];
  pendingUserMessages: number; // queued while boss is busy
  exitPending: boolean;
}

const initialState: BossUiState = {
  bossModel: "",
  workerModel: "",
  history: [],
  pendingFlush: [],
  flushGeneration: 0,
  streaming: null,
  phase: "idle",
  workers: [],
  pendingUserMessages: 0,
  exitPending: false,
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
    bossModel: string;
    workerModel: string;
    workers: { name: string; cwd: string }[];
  }): void {
    state = {
      ...initialState,
      bossModel: opts.bossModel,
      workerModel: opts.workerModel,
      workers: opts.workers.map((w) => ({ name: w.name, cwd: w.cwd, status: "idle" })),
    };
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
      streaming: { text: "", tools: [], startedAt: Date.now() },
    };
    notify();
  },

  appendStreamText(text: string): void {
    if (!state.streaming) return;
    state = {
      ...state,
      streaming: { ...state.streaming, text: state.streaming.text + text },
    };
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
    const item: HistoryItem = {
      kind: "assistant",
      id: id(),
      text,
      durationMs: Date.now() - state.streaming.startedAt,
    };
    state = {
      ...state,
      streaming: { ...state.streaming, text: "", startedAt: Date.now() },
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
      items.push({
        kind: "assistant",
        id: id(),
        text: tail,
        durationMs: Date.now() - state.streaming.startedAt,
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

  setExitPending(pending: boolean): void {
    if (state.exitPending === pending) return;
    state = { ...state, exitPending: pending };
    notify();
  },

  reset(): void {
    state = initialState;
    notify();
  },
};
