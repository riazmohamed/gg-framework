import { AgentSession } from "@abukhaled/ogcoder";
import type { Provider, ThinkingLevel } from "@abukhaled/gg-ai";
import type { EventQueue } from "./event-queue.js";
import type { ToolUseSummary, WorkerStatus, WorkerTurnSummary } from "./types.js";
import { bossStore } from "./boss-store.js";
import { log } from "./logger.js";

/**
 * Wrap a sync event-bus handler so any thrown error becomes a worker_error
 * event instead of cascading up through ggcoder's eventBus.emit and
 * potentially killing the boss process. Worker bus handlers do non-trivial
 * work (state mutations, queue pushes); a bug in any of them must NEVER
 * crash gg-boss because that would take down all 6+ workers in the same
 * process.
 */
function safeBusHandler<T>(
  workerName: string,
  handlerName: string,
  fn: (event: T) => void,
  onError: (message: string) => void,
): (event: T) => void {
  return (event) => {
    try {
      fn(event);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("ERROR", "worker", `bus handler "${handlerName}" threw`, {
        worker: workerName,
        message,
      });
      onError(`Worker "${workerName}" event handler error: ${message}`);
    }
  };
}

export interface WorkerOptions {
  name: string;
  cwd: string;
  provider: Provider;
  model: string;
  thinkingLevel?: ThinkingLevel;
  signal: AbortSignal;
  queue: EventQueue;
}

/**
 * One worker per project. Wraps an AgentSession and translates its event
 * stream into BossEvents pushed onto the shared queue.
 *
 * - prompt() is fire-and-forget: returns immediately, completion arrives later
 *   on the queue as a worker_turn_complete event.
 * - The worker buffers text + tool calls during a turn and emits a single
 *   summary on agent_done.
 */
export class Worker {
  readonly name: string;
  readonly cwd: string;

  private session: AgentSession;
  private queue: EventQueue;
  private status: WorkerStatus = "idle";
  private turnCount = 0;
  private currentText = "";
  private currentTools: ToolUseSummary[] = [];
  private activeTools = new Map<string, string>();

  constructor(opts: WorkerOptions) {
    this.name = opts.name;
    this.cwd = opts.cwd;
    this.queue = opts.queue;
    this.session = new AgentSession({
      provider: opts.provider,
      model: opts.model,
      cwd: opts.cwd,
      thinkingLevel: opts.thinkingLevel,
      signal: opts.signal,
    });
  }

  async initialize(): Promise<void> {
    await this.session.initialize();
    this.wireEvents();
  }

  getStatus(): WorkerStatus {
    return this.status;
  }

  async prompt(text: string): Promise<void> {
    if (this.status === "working") {
      throw new Error(`Worker "${this.name}" is already working`);
    }
    this.status = "working";
    bossStore.setWorkerStatus(this.name, "working");
    this.currentText = "";
    this.currentTools = [];
    // Fire-and-forget. Errors surface via the eventBus error handler below.
    void this.session.prompt(text).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.status = "error";
      const ts = new Date().toISOString();
      bossStore.appendWorkerError(this.name, message, ts);
      this.queue.push({
        kind: "worker_error",
        project: this.name,
        message,
        timestamp: ts,
      });
    });
  }

  async dispose(): Promise<void> {
    await this.session.dispose();
  }

  async switchModel(provider: Provider, model: string): Promise<void> {
    await this.session.switchModel(provider, model);
  }

  /**
   * Wipe this worker's conversation history and start a new session file.
   * Used by `prompt_worker(..., fresh: true)` when the boss declares the
   * incoming task is a meaningful direction change — keeps the worker's
   * context lean instead of dragging stale exploration along forever.
   */
  async newSession(): Promise<void> {
    await this.session.newSession();
    this.turnCount = 0;
  }

  private wireEvents(): void {
    const bus = this.session.eventBus;
    // Every handler is wrapped in safeBusHandler so a thrown error becomes
    // a worker_error event instead of bubbling up through eventBus.emit
    // and crashing the boss process. The shared single-process model means
    // ANY uncaught throw here would take all workers down with it.
    const reportError = (message: string): void => {
      const ts = new Date().toISOString();
      this.status = "error";
      bossStore.appendWorkerError(this.name, message, ts);
      this.queue.push({
        kind: "worker_error",
        project: this.name,
        message,
        timestamp: ts,
      });
    };

    bus.on(
      "text_delta",
      safeBusHandler<{ text: string }>(
        this.name,
        "text_delta",
        ({ text }) => {
          this.currentText += text;
        },
        reportError,
      ),
    );

    bus.on(
      "tool_call_start",
      safeBusHandler<{ toolCallId: string; name: string }>(
        this.name,
        "tool_call_start",
        ({ toolCallId, name }) => {
          this.activeTools.set(toolCallId, name);
        },
        reportError,
      ),
    );

    bus.on(
      "tool_call_end",
      safeBusHandler<{ toolCallId: string; isError: boolean }>(
        this.name,
        "tool_call_end",
        ({ toolCallId, isError }) => {
          const name = this.activeTools.get(toolCallId);
          this.activeTools.delete(toolCallId);
          if (name) this.currentTools.push({ name, ok: !isError });
        },
        reportError,
      ),
    );

    bus.on(
      "agent_done",
      safeBusHandler<unknown>(
        this.name,
        "agent_done",
        () => {
          this.turnCount += 1;
          const summary: WorkerTurnSummary = {
            project: this.name,
            cwd: this.cwd,
            status: "idle",
            finalText: this.currentText.trim(),
            toolsUsed: [...this.currentTools],
            turnIndex: this.turnCount,
            timestamp: new Date().toISOString(),
          };
          this.currentText = "";
          this.currentTools = [];
          this.status = "idle";
          bossStore.appendWorkerEvent(summary);
          this.queue.push({ kind: "worker_turn_complete", summary });
        },
        reportError,
      ),
    );

    bus.on(
      "error",
      safeBusHandler<{ error: Error }>(
        this.name,
        "error",
        ({ error }) => {
          reportError(error.message);
        },
        reportError,
      ),
    );
  }
}
