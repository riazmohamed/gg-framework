import { Agent, isAbortError } from "@kenkaiiii/gg-agent";
import { AuthStorage } from "@kenkaiiii/ggcoder";
import type { Provider, ThinkingLevel } from "@kenkaiiii/gg-ai";
import { Worker } from "./worker.js";
import { EventQueue } from "./event-queue.js";
import { createBossTools } from "./tools.js";
import { buildBossSystemPrompt } from "./boss-system-prompt.js";
import { bossStore } from "./boss-store.js";
import type { BossEvent, ProjectSpec, WorkerTurnSummary } from "./types.js";

export interface GGBossOptions {
  bossProvider: Provider;
  bossModel: string;
  workerProvider: Provider;
  workerModel: string;
  workerThinkingLevel?: ThinkingLevel;
  projects: ProjectSpec[];
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
  private running = false;
  private pendingUserMessages = 0;
  private opts: GGBossOptions;
  private authStorage = new AuthStorage();

  constructor(opts: GGBossOptions) {
    this.opts = opts;
  }

  async initialize(): Promise<void> {
    bossStore.init({
      bossModel: this.opts.bossModel,
      workerModel: this.opts.workerModel,
      workers: this.opts.projects.map((p) => ({ name: p.name, cwd: p.cwd })),
    });

    await this.authStorage.load();

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
    const tools = createBossTools({
      workers: this.workers,
      lastSummaries: this.lastSummaries,
    });

    this.bossAgent = new Agent({
      provider: this.opts.bossProvider,
      model: this.opts.bossModel,
      system: buildBossSystemPrompt(this.opts.projects),
      tools,
      apiKey: creds.accessToken,
      accountId: creds.accountId,
      signal: this.ac.signal,
      cacheRetention: "short",
    });
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
      }

      const text = formatEventForBoss(event);
      bossStore.startStreaming();
      try {
        const stream = this.bossAgent.prompt(text);
        for await (const e of stream) {
          switch (e.type) {
            case "text_delta":
              bossStore.appendStreamText(e.text);
              break;
            case "tool_call_start":
              // Flush any preceding text so chronological order is preserved
              // in scrollback (text → tool → text → tool, not text-block then tool-block).
              bossStore.flushPendingText();
              bossStore.startTool(e.toolCallId, e.name, e.args);
              break;
            case "tool_call_end":
              bossStore.endTool(e.toolCallId, e.isError, e.durationMs, e.result, e.details);
              break;
            case "turn_end":
              // Flush trailing text from this turn. Subsequent turns may add more.
              bossStore.flushPendingText();
              break;
            case "error":
              bossStore.appendInfo(e.error.message, "error");
              break;
            default:
              break;
          }
        }
      } catch (err) {
        if (isAbortError(err)) {
          bossStore.finishStreaming();
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        bossStore.appendInfo(message, "error");
      }
      bossStore.finishStreaming();
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
