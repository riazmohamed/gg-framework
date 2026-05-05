import { Agent, isAbortError } from "@abukhaled/gg-agent";
import {
  AuthStorage,
  compact,
  estimateConversationTokens,
  getContextWindow,
  shouldCompact,
} from "@abukhaled/ogcoder";
import type { Message, Provider, ThinkingLevel, Usage } from "@abukhaled/gg-ai";
import { Worker } from "./worker.js";
import { EventQueue } from "./event-queue.js";
import { createBossTools, WORKER_PROMPT_BRIEF } from "./tools.js";
import { createTaskTools } from "./task-tools.js";
import { tasksStore } from "./tasks-store.js";
import { buildBossSystemPrompt } from "./boss-system-prompt.js";
import { bossStore } from "./boss-store.js";
import {
  appendMessages,
  createSession,
  getMostRecent,
  getSessionById,
  loadSession,
} from "./sessions.js";
import type { BossEvent, ProjectSpec, WorkerTurnSummary } from "./types.js";

export interface GGBossOptions {
  bossProvider: Provider;
  bossModel: string;
  workerProvider: Provider;
  workerModel: string;
  workerThinkingLevel?: ThinkingLevel;
  projects: ProjectSpec[];
  /** Resume a specific boss session by id. Mutually exclusive with continueRecent. */
  resumeSessionId?: string;
  /** Resume the most recently used boss session. */
  continueRecent?: boolean;
}

/**
 * The orchestrator. Owns N workers, a single shared event queue, and the boss Agent.
 * Each loop iteration: pop one event, format it as a user message, run the boss for
 * one full prompt (which may dispatch tool calls to workers), then await the next event.
 *
 * UI state is mirrored into bossStore — components subscribe via useBossState().
 */
export class GGBoss {
  private workers = new Map<string, Worker>();
  private lastSummaries = new Map<string, WorkerTurnSummary>();
  private queue = new EventQueue();
  private bossAgent!: Agent;
  private ac = new AbortController();
  /** Per-turn AbortController so ESC can cancel the current LLM call without killing workers. */
  private turnAc: AbortController | null = null;
  private running = false;
  private pendingUserMessages = 0;
  private opts: GGBossOptions;
  private authStorage = new AuthStorage();
  /** Path to the boss's per-session jsonl log under ~/.gg/boss/sessions/. */
  private sessionPath = "";
  /** Last index in the boss's messages array we've persisted to disk. */
  private lastPersistedIndex = 0;
  /** project → task id currently dispatched to that worker. Used to mark
   *  the right task done/blocked when the worker_turn_complete event arrives. */
  private inFlightTaskByProject = new Map<string, string>();

  constructor(opts: GGBossOptions) {
    this.opts = opts;
  }

  async initialize(): Promise<void> {
    await this.authStorage.load();
    await tasksStore.load();
    const loggedInProviders = (await this.authStorage.listProviders()) as Provider[];

    bossStore.init({
      bossProvider: this.opts.bossProvider,
      bossModel: this.opts.bossModel,
      workerProvider: this.opts.workerProvider,
      workerModel: this.opts.workerModel,
      loggedInProviders,
      workers: this.opts.projects.map((p) => ({ name: p.name, cwd: p.cwd })),
    });

    await Promise.all(
      this.opts.projects.map(async (p) => {
        const worker = new Worker({
          name: p.name,
          cwd: p.cwd,
          provider: this.opts.workerProvider,
          model: this.opts.workerModel,
          thinkingLevel: this.opts.workerThinkingLevel,
          signal: this.ac.signal,
          queue: this.queue,
        });
        await worker.initialize();
        this.workers.set(p.name, worker);
      }),
    );

    const creds = await this.authStorage.resolveCredentials(this.opts.bossProvider);
    const tools = this.buildToolSet();

    // Either resume a prior session (load messages from jsonl), or create a
    // new one. Either way we end up with `sessionPath` to persist into.
    let priorMessages: Message[] | undefined;
    if (this.opts.resumeSessionId) {
      const info = await getSessionById(this.opts.resumeSessionId);
      if (info) {
        this.sessionPath = info.path;
        priorMessages = (await loadSession(info.path)).filter((m) => m.role !== "system");
      }
    } else if (this.opts.continueRecent) {
      const recent = await getMostRecent();
      if (recent) {
        this.sessionPath = recent.path;
        priorMessages = (await loadSession(recent.path)).filter((m) => m.role !== "system");
      }
    }
    if (!this.sessionPath) {
      const session = await createSession();
      this.sessionPath = session.filePath;
    }
    // Rebuild the visible TUI history from the loaded messages so the chat
    // shows the prior conversation, not just the agent's hidden context.
    if (priorMessages && priorMessages.length > 0) {
      bossStore.restoreHistory(priorMessages);
    }

    this.bossAgent = new Agent({
      provider: this.opts.bossProvider,
      model: this.opts.bossModel,
      system: buildBossSystemPrompt(this.opts.projects),
      tools,
      apiKey: creds.accessToken,
      accountId: creds.accountId,
      signal: this.ac.signal,
      cacheRetention: "short",
      priorMessages,
    });
    // Mark every loaded message as already persisted so we only append NEW
    // turns going forward. The system message is added by Agent's constructor
    // and we never want to write the system prompt to disk (it's rebuilt each
    // session from current project list) — so subtract one for it.
    this.lastPersistedIndex = this.bossAgent.getMessages().length;

    // Seed the context-bar estimate so it shows real progress before the first
    // turn_end event fires. Especially critical on `ggboss continue` where
    // we'd otherwise show 0% over a session that's already half-full.
    const initialMessages = this.bossAgent.getMessages();
    if (initialMessages.length > 1) {
      bossStore.setBossInputTokens(estimateConversationTokens(initialMessages));
    }
  }

  enqueueUserMessage(text: string): void {
    this.pendingUserMessages++;
    bossStore.setPendingMessages(this.pendingUserMessages);
    this.queue.push({
      kind: "user_message",
      text,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Abort the boss's current LLM call (e.g. user pressed ESC). Workers and the
   * orchestrator's run loop keep going. The next event in the queue gets a
   * fresh AbortController.
   */
  abort(): void {
    this.turnAc?.abort();
  }

  /** Boss tool set = orchestration tools + task management tools. */
  private buildToolSet() {
    const bossTools = createBossTools({
      workers: this.workers,
      lastSummaries: this.lastSummaries,
    });
    const taskTools = createTaskTools({
      workers: this.workers,
      dispatchTaskByDescription: (project, description, fresh, taskId) =>
        this.dispatchTaskByDescription(project, description, fresh, taskId),
    });
    return [...bossTools, ...taskTools];
  }

  /**
   * Dispatch a single task to a specific worker, marking it in_progress and
   * (eventually) done when the worker_turn_complete event arrives. Used by:
   *  - the dispatch_pending tool (called by the boss agent)
   *  - the Tasks overlay (when user presses Enter on a task)
   *
   * Returns immediately — fire-and-forget like prompt_worker.
   */
  async dispatchTaskById(taskId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const task = tasksStore.byId(taskId);
    if (!task) return { ok: false, reason: "unknown task id" };
    const w = this.workers.get(task.project);
    if (!w) return { ok: false, reason: `unknown project: ${task.project}` };
    if (w.getStatus() === "working") return { ok: false, reason: "worker is busy" };
    await tasksStore.update(task.id, { status: "in_progress" });
    return this.dispatchTaskByDescription(
      task.project,
      task.description,
      task.fresh === true,
      task.id,
    );
  }

  /**
   * Dispatch a task description to a worker. Used by both the task tool and
   * the overlay (via dispatchTaskById). Tracks the in-flight task id per
   * project so worker_turn_complete can resolve it back to the right task.
   */
  private async dispatchTaskByDescription(
    project: string,
    description: string,
    fresh: boolean,
    taskId: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const w = this.workers.get(project);
    if (!w) return { ok: false, reason: `unknown project: ${project}` };
    if (w.getStatus() === "working") return { ok: false, reason: "worker is busy" };
    if (fresh) await w.newSession();
    this.inFlightTaskByProject.set(project, taskId);
    await w.prompt(WORKER_PROMPT_BRIEF + description);
    return { ok: true };
  }

  /**
   * Swap the boss's LLM model. Preserves message history so the conversation
   * continues seamlessly under the new model.
   */
  async switchBossModel(provider: Provider, model: string): Promise<void> {
    const tools = this.buildToolSet();
    const creds = await this.authStorage.resolveCredentials(provider);
    // Capture history minus the system message — Agent re-adds system from options.
    const oldMessages = this.bossAgent.getMessages().filter((m) => m.role !== "system");

    this.opts.bossProvider = provider;
    this.opts.bossModel = model;

    this.bossAgent = new Agent({
      provider,
      model,
      system: buildBossSystemPrompt(this.opts.projects),
      tools,
      apiKey: creds.accessToken,
      accountId: creds.accountId,
      signal: this.ac.signal,
      cacheRetention: "short",
      priorMessages: oldMessages,
    });

    bossStore.setBossModel(provider, model);
  }

  /** Swap every worker's model. Workers keep their per-project sessions. */
  async switchWorkerModel(provider: Provider, model: string): Promise<void> {
    await Promise.all([...this.workers.values()].map((w) => w.switchModel(provider, model)));
    this.opts.workerProvider = provider;
    this.opts.workerModel = model;
    bossStore.setWorkerModel(provider, model);
  }

  /**
   * Run a manual compaction now (driven by /compact). Will compact even if the
   * threshold isn't reached yet — useful for trimming context before a long task.
   */
  async manualCompact(): Promise<void> {
    await this.runCompaction(true);
  }

  /** Compact only when threshold (default 80%) is exceeded. */
  private async runCompaction(force: boolean): Promise<void> {
    const messages = this.bossAgent.getMessages();
    const contextWindow = getContextWindow(this.opts.bossModel);
    const tokens = bossStore.getInputTokens();
    if (!force && !shouldCompact(messages, contextWindow, 0.8, tokens)) return;

    bossStore.startCompaction();
    try {
      const creds = await this.authStorage.resolveCredentials(this.opts.bossProvider);
      const { messages: compactedMessages, result } = await compact(messages, {
        provider: this.opts.bossProvider,
        model: this.opts.bossModel,
        apiKey: creds.accessToken,
        contextWindow,
        signal: this.ac.signal,
      });
      await this.replaceBossMessages(compactedMessages);
      // Start a new session file so `ggboss continue` resumes the COMPACTED
      // history, not the full original. Mirrors ggcoder/AgentSession.compact.
      const session = await createSession();
      this.sessionPath = session.filePath;
      this.lastPersistedIndex = 0;
      await this.persistNewMessages();
      bossStore.setBossInputTokens(0);
      bossStore.endCompaction(result.originalCount, result.newCount);
    } catch (err) {
      bossStore.cancelCompaction();
      if (!isAbortError(err)) {
        const message = err instanceof Error ? err.message : String(err);
        bossStore.appendInfo(`Compaction failed: ${message}`, "error");
      }
    }
  }

  /**
   * Append any boss messages that haven't been written yet to the session log.
   * Skips the system message (regenerated each session from current project list).
   */
  private async persistNewMessages(): Promise<void> {
    if (!this.sessionPath) return;
    const all = this.bossAgent.getMessages();
    const newOnes = all.slice(this.lastPersistedIndex).filter((m) => m.role !== "system");
    if (newOnes.length === 0) return;
    try {
      await appendMessages(this.sessionPath, newOnes);
      this.lastPersistedIndex = all.length;
    } catch {
      // Persistence is best-effort — never crash the run loop on disk errors.
    }
  }

  /** Recreate bossAgent with a new message history (used by compact + /clear). */
  private async replaceBossMessages(newMessages: Message[]): Promise<void> {
    const tools = this.buildToolSet();
    const creds = await this.authStorage.resolveCredentials(this.opts.bossProvider);
    // Strip system — Agent re-adds it from `system`.
    const priorMessages = newMessages.filter((m) => m.role !== "system");
    this.bossAgent = new Agent({
      provider: this.opts.bossProvider,
      model: this.opts.bossModel,
      system: buildBossSystemPrompt(this.opts.projects),
      tools,
      apiKey: creds.accessToken,
      accountId: creds.accountId,
      signal: this.ac.signal,
      cacheRetention: "short",
      priorMessages,
    });
  }

  /**
   * Start a brand-new boss session — fresh agent with no message history,
   * fresh session file on disk so `ggboss continue` picks up the new chat.
   * Workers are unaffected.
   */
  async newSession(): Promise<void> {
    const session = await createSession();
    this.sessionPath = session.filePath;
    this.lastPersistedIndex = 0;
    await this.replaceBossMessages([]);
    bossStore.setBossInputTokens(0);
    // Mark the post-construction message count (just system) as persisted so
    // we don't try to write it.
    this.lastPersistedIndex = this.bossAgent.getMessages().length;
  }

  /** Alias kept for the existing /clear path which used "reset" terminology. */
  async resetConversation(): Promise<void> {
    return this.newSession();
  }

  async run(): Promise<void> {
    this.running = true;
    while (this.running) {
      const event = await this.queue.next();
      if (!this.running) break;

      if (event.kind === "user_message") {
        this.pendingUserMessages = Math.max(0, this.pendingUserMessages - 1);
        bossStore.setPendingMessages(this.pendingUserMessages);
      }
      if (event.kind === "worker_turn_complete") {
        this.lastSummaries.set(event.summary.project, event.summary);
        // Resolve any in-flight task for this project to its final status.
        // Boss can still override via update_task — this just gives it a sane
        // default so the user's overlay-driven dispatches close out cleanly.
        const taskId = this.inFlightTaskByProject.get(event.summary.project);
        if (taskId) {
          this.inFlightTaskByProject.delete(event.summary.project);
          const task = tasksStore.byId(taskId);
          if (task && task.status === "in_progress") {
            const failed = event.summary.toolsUsed.some((t) => !t.ok);
            await tasksStore.update(taskId, {
              status: failed ? "blocked" : "done",
              resultSummary: event.summary.finalText,
            });
          }
        }
      }
      if (event.kind === "worker_error") {
        const taskId = this.inFlightTaskByProject.get(event.project);
        if (taskId) {
          this.inFlightTaskByProject.delete(event.project);
          await tasksStore.update(taskId, {
            status: "blocked",
            notes: `Worker error: ${event.message}`,
          });
        }
      }

      // Auto-compact when over 80% of context — mirrors AgentSession.runLoop.
      // Workers handle their own compaction independently (via AgentSession).
      await this.runCompaction(false);

      const text = formatEventForBoss(event);
      bossStore.startStreaming();

      // Fresh AbortController for this turn so ESC can cancel just this call.
      this.turnAc = new AbortController();
      this.bossAgent.setSignal(this.turnAc.signal);

      try {
        const stream = this.bossAgent.prompt(text);
        for await (const e of stream) {
          switch (e.type) {
            case "text_delta":
              bossStore.appendStreamText(e.text);
              break;
            case "thinking_delta":
              bossStore.appendStreamThinking(e.text);
              break;
            case "tool_call_start":
              // Flush any preceding text so chronological order is preserved
              // in scrollback (text → tool → text → tool, not text-block then tool-block).
              bossStore.flushPendingText();
              bossStore.startTool(e.toolCallId, e.name, e.args);
              bossStore.setActivityPhase("tools");
              break;
            case "tool_call_end":
              bossStore.endTool(e.toolCallId, e.isError, e.durationMs, e.result, e.details);
              break;
            case "turn_end":
              // Mirror ggcoder/useAgentLoop: total context = uncached input +
              // cache reads + cache writes (Anthropic separates input/output,
              // others share the window so include output too). Without adding
              // cache, prompt-cached calls report a tiny inputTokens delta and
              // the footer bar appears stuck at 0%.
              if (e.usage) {
                bossStore.setBossInputTokens(computeContextUsed(e.usage, this.opts.bossProvider));
              }
              // Flush trailing text from this turn. Subsequent turns may add more.
              bossStore.flushPendingText();
              break;
            case "retry":
              if (!e.silent) {
                bossStore.setRetryInfo({
                  reason: e.reason,
                  attempt: e.attempt,
                  maxAttempts: e.maxAttempts,
                  delayMs: e.delayMs,
                });
              }
              break;
            case "error":
              bossStore.appendInfo(formatProviderError(e.error.message), "error");
              break;
            default:
              break;
          }
        }
      } catch (err) {
        if (isAbortError(err)) {
          // Mirror ggcoder's onAborted: convert any in-flight tools to
          // "Stopped." entries so the user sees the same visual feedback.
          bossStore.interruptStreaming();
          if (!this.running) {
            bossStore.finishStreaming();
            return;
          }
          bossStore.appendInfo("Interrupted by user.", "warning");
          bossStore.finishStreaming();
          await this.persistNewMessages();
          continue;
        }
        const message = err instanceof Error ? err.message : String(err);
        bossStore.appendInfo(formatProviderError(message), "error");
      }
      bossStore.finishStreaming();
      await this.persistNewMessages();
    }
  }

  async dispose(): Promise<void> {
    this.running = false;
    this.ac.abort();
    // Wake the queue if it's blocked on next() so the run loop can exit.
    this.queue.push({
      kind: "user_message",
      text: "[shutdown]",
      timestamp: new Date().toISOString(),
    });
    await Promise.all([...this.workers.values()].map((w) => w.dispose()));
  }
}

function formatEventForBoss(event: BossEvent): string {
  if (event.kind === "user_message") {
    return event.text;
  }
  if (event.kind === "worker_turn_complete") {
    const s = event.summary;
    const tools =
      s.toolsUsed.length > 0
        ? s.toolsUsed.map((t) => `${t.ok ? "✓" : "✗"}${t.name}`).join(", ")
        : "(none)";
    return `[event:worker_turn_complete] project="${s.project}" turn=${s.turnIndex} timestamp=${s.timestamp}
tools_used: ${tools}
final_text:
${s.finalText || "(empty)"}`;
  }
  return `[event:worker_error] project="${event.project}" timestamp=${event.timestamp}
${event.message}`;
}

/**
 * Total context used in tokens. Mirrors ggcoder/useAgentLoop: Anthropic counts
 * uncached input + cache reads/writes (output is metered separately); other
 * providers share a single window so output counts too.
 */
function computeContextUsed(usage: Usage, provider: Provider): number {
  const inputContext = (usage.inputTokens ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  return provider === "anthropic" ? inputContext : inputContext + (usage.outputTokens ?? 0);
}

/**
 * Map raw provider error text to a human-friendly hint. Mirrors ggcoder's
 * pattern in App.tsx so users see the same diagnostic phrasing.
 */
function formatProviderError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("overloaded") || lower.includes("engine_overloaded")) {
    return `${message}\nHint: provider is under heavy load — try again in a moment.`;
  }
  if (
    lower.includes("insufficient balance") ||
    lower.includes("quota exceeded") ||
    lower.includes("recharge")
  ) {
    return `${message}\nHint: billing or quota issue — check your account balance.`;
  }
  if (
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("429")
  ) {
    return `${message}\nHint: provider rate limit — wait a moment before retrying.`;
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return `${message}\nHint: provider timed out — their servers may be slow.`;
  }
  if (
    lower.includes("does not recognize the requested model") ||
    (lower.includes("model") && (lower.includes("not exist") || lower.includes("not found")))
  ) {
    return `${message}\nHint: use /model to switch, or check that your account has access.`;
  }
  return message;
}
