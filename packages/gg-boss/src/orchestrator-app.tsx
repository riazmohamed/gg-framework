import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Static, Text, render, useApp, useInput } from "ink";
import { ThemeContext, loadTheme, useTheme } from "@kenkaiiii/ggcoder/ui/theme";
import {
  ActivityIndicator,
  AnimationProvider,
  AssistantMessage,
  CompactionDone,
  CompactionSpinner,
  InputArea,
  MessageResponse,
  ModelSelector,
  StreamingArea,
  ToolExecution,
  ToolUseLoader,
  UserMessage,
} from "@kenkaiiii/ggcoder/ui";
import { useDoublePress } from "@kenkaiiii/ggcoder/ui/hooks/double-press";
import type { Provider } from "@kenkaiiii/gg-ai";
import { TerminalSizeProvider, useTerminalSize } from "@kenkaiiii/ggcoder/ui/hooks/terminal-size";
import { BossFooter } from "./boss-footer.js";
import { BossBanner } from "./banner.js";
import { bossStore, useBossState } from "./boss-store.js";
import type {
  AssistantItem,
  HistoryItem,
  StreamingTool,
  StreamingTurn,
  ToolItem,
  WorkerEventItem,
  WorkerErrorItem,
  WorkerView,
} from "./boss-store.js";
import { BOSS_SLASH_COMMANDS, canonicalName, parseSlash, buildHelpText } from "./slash-commands.js";
import { bossToolFormatters } from "./tool-formatters.js";
import type { GGBoss } from "./orchestrator.js";

interface BannerRow {
  kind: "banner";
  id: string;
}
type StaticRow = BannerRow | HistoryItem;

interface BossAppProps {
  boss: GGBoss;
}

export function BossApp({ boss }: BossAppProps): React.ReactElement {
  const theme = loadTheme("dark");
  return (
    <TerminalSizeProvider>
      <ThemeContext.Provider value={theme}>
        <AnimationProvider>
          <BossAppInner boss={boss} />
        </AnimationProvider>
      </ThemeContext.Provider>
    </TerminalSizeProvider>
  );
}

function BossAppInner({ boss }: BossAppProps): React.ReactElement {
  const state = useBossState();
  const { exit } = useApp();
  const runStartRef = useRef<number | null>(null);
  runStartRef.current = state.runStartMs;
  const [overlay, setOverlay] = useState<"model-boss" | "model-workers" | null>(null);

  const staticItems: StaticRow[] = useMemo(
    () => [{ kind: "banner", id: "banner" }, ...state.history],
    [state.history],
  );

  // ggcoder's double-press pattern: 800ms window. First press shows
  // "Press Ctrl+C again to exit" in the footer; second within 800ms exits.
  const handleDoubleExit = useDoublePress(
    (pending) => bossStore.setExitPending(pending),
    () => exit(),
  );

  // Two-phase flush — see boss-store.ts for the rationale. Phase 1 (orchestrator
  // pushes into pendingFlush, live area shrinks) already happened; phase 2 here
  // commits to history on the next render so Ink doesn't clip long responses.
  useEffect(() => {
    if (state.pendingFlush.length > 0) {
      bossStore.commitPendingFlush();
    }
  }, [state.flushGeneration, state.pendingFlush.length]);

  // ── ESC interrupt ───────────────────────────────────────
  // Listen at the App level. When the boss is running, ESC aborts its current
  // LLM call. When idle, InputArea handles ESC (clear input / clear selection)
  // and our handler is a no-op since `state.phase !== "working"`.
  useInput((_input, key) => {
    if (key.escape && state.phase === "working") {
      boss.abort();
    }
  });

  const handleSlashCommand = async (value: string): Promise<boolean> => {
    const parsed = parseSlash(value);
    if (!parsed) return false;
    const name = canonicalName(parsed.name);
    if (!name) {
      bossStore.appendInfo(`Unknown command: /${parsed.name}`, "warning");
      return true;
    }
    switch (name) {
      case "help":
        bossStore.appendUser(value);
        // Render help via an assistant block so Markdown formatting + dot prefix.
        bossStore.appendInfo(buildHelpText(), "info");
        return true;
      case "clear":
        bossStore.clearHistory();
        await boss.resetConversation();
        return true;
      case "workers":
        bossStore.appendUser(value);
        bossStore.appendInfo(formatWorkerList(state.workers), "info");
        return true;
      case "model-boss":
        setOverlay("model-boss");
        return true;
      case "model-workers":
        setOverlay("model-workers");
        return true;
      case "compact":
        bossStore.appendUser(value);
        await boss.manualCompact();
        return true;
      case "new":
        bossStore.clearHistory();
        await boss.newSession();
        return true;
      case "quit":
        exit();
        return true;
    }
    return false;
  };

  const handleModelSelect = (value: string): void => {
    const colon = value.indexOf(":");
    if (colon < 0) {
      setOverlay(null);
      return;
    }
    const provider = value.slice(0, colon) as Provider;
    const model = value.slice(colon + 1);
    if (overlay === "model-boss") {
      void boss.switchBossModel(provider, model);
    } else if (overlay === "model-workers") {
      void boss.switchWorkerModel(provider, model);
    }
    setOverlay(null);
  };

  const handleSubmit = (value: string): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
      void handleSlashCommand(trimmed);
      return;
    }
    // Show the user's literal text in chat history.
    bossStore.appendUser(trimmed);
    // Inject the scope pill into the message the boss actually sees, so the
    // user doesn't have to write "for the yaatuber project, …" every prompt.
    const scoped = scopePrefix(state.scope) + trimmed;
    boss.enqueueUserMessage(scoped);
  };

  const handleAbort = (): void => {
    // Ctrl+C while boss is running → single-press abort (matches ggcoder).
    if (state.phase === "working") {
      boss.abort();
      return;
    }
    // Boss is idle → double-press to exit, with footer pending message.
    handleDoubleExit();
  };

  return (
    <Box flexDirection="column">
      <Static items={staticItems}>{(item) => <StaticRowView key={item.id} row={item} />}</Static>

      {state.streaming && (
        <StreamingTurnView turn={state.streaming} isRunning={state.phase === "working"} />
      )}
      {state.phase === "working" && (
        <Box marginTop={1}>
          <ActivityIndicator
            phase={state.activityPhase}
            elapsedMs={state.runStartMs ? Date.now() - state.runStartMs : 0}
            runStartRef={runStartRef as React.RefObject<number>}
            thinkingMs={state.streaming?.thinkingMs ?? 0}
            isThinking={state.activityPhase === "thinking"}
            tokenEstimate={state.bossInputTokens}
            activeToolNames={(state.streaming?.tools ?? [])
              .filter((t) => t.status === "running")
              .map((t) => t.name)}
            retryInfo={state.retryInfo}
          />
        </Box>
      )}
      {state.compaction?.state === "running" && <CompactionSpinner />}
      {state.compaction?.state === "done" && (
        <CompactionDone
          originalCount={state.compaction.originalCount}
          newCount={state.compaction.newCount}
          tokensBefore={state.compaction.tokensBefore}
          tokensAfter={state.compaction.tokensAfter}
        />
      )}

      <InputArea
        onSubmit={handleSubmit}
        onAbort={handleAbort}
        disabled={state.phase === "working"}
        isActive={!overlay}
        cwd={process.cwd()}
        commands={BOSS_SLASH_COMMANDS}
        scopeBadge={<ScopePill scope={state.scope} />}
        onTab={() => bossStore.cycleScope()}
      />

      {overlay ? (
        <ModelSelector
          onSelect={handleModelSelect}
          onCancel={() => setOverlay(null)}
          loggedInProviders={state.loggedInProviders}
          currentModel={overlay === "model-boss" ? state.bossModel : state.workerModel}
          currentProvider={overlay === "model-boss" ? state.bossProvider : state.workerProvider}
        />
      ) : (
        <>
          <BossFooter
            bossModel={state.bossModel}
            workerModel={state.workerModel}
            tokensIn={state.bossInputTokens}
            exitPending={state.exitPending}
          />
          {/* Hide the worker bar during the exit-confirm prompt so the
              "Press Ctrl+C again" message is the very last line — matches
              ggcoder where the Footer always owns the bottom row when pending. */}
          {!state.exitPending && (
            <WorkerStatusBar workers={state.workers} pendingMessages={state.pendingUserMessages} />
          )}
        </>
      )}
    </Box>
  );
}

// ── Scope pill (gg-boss specific) ──────────────────────────

function ScopePill({ scope }: { scope: string }): React.ReactElement {
  const theme = useTheme();
  const isAll = scope === "all";
  // "All" gets the accent color so it visually pops as the multi-project mode;
  // specific projects use primary so they read as a normal selection pill.
  const bg = isAll ? theme.accent : theme.primary;
  const label = isAll ? "All" : scope;
  return (
    <Text color="white" backgroundColor={bg} bold>
      {` ${label} `}
    </Text>
  );
}

/**
 * Prepend the active scope to the user's message before it reaches the boss.
 * Boss's system prompt teaches it to interpret these prefixes.
 */
function scopePrefix(scope: string): string {
  if (scope === "all") return "[scope:all] ";
  return `[scope:${scope}] `;
}

// ── Worker status row (gg-boss specific) ───────────────────

const WORKER_GLYPH: Record<WorkerView["status"], string> = {
  idle: "○",
  working: "●",
  error: "✗",
};

function WorkerStatusBar({
  workers,
  pendingMessages,
}: {
  workers: WorkerView[];
  pendingMessages: number;
}): React.ReactElement | null {
  const theme = useTheme();
  if (workers.length === 0) return null;
  return (
    <Box paddingX={1}>
      {workers.map((w, i) => {
        const color =
          w.status === "working"
            ? theme.accent
            : w.status === "error"
              ? theme.error
              : theme.textDim;
        const labelColor =
          w.status === "working" ? theme.text : w.status === "error" ? theme.error : theme.textDim;
        return (
          <React.Fragment key={w.name}>
            {i > 0 && <Text color={theme.textDim}>{"  "}</Text>}
            <Text color={color}>{WORKER_GLYPH[w.status]} </Text>
            <Text color={labelColor} bold={w.status === "working"}>
              {w.name}
            </Text>
          </React.Fragment>
        );
      })}
      {pendingMessages > 0 && (
        <>
          <Text color={theme.textDim}>{"   "}</Text>
          <Text color={theme.warning}>
            {pendingMessages} message{pendingMessages === 1 ? "" : "s"} queued
          </Text>
        </>
      )}
    </Box>
  );
}

function formatWorkerList(workers: WorkerView[]): string {
  if (workers.length === 0) return "(no workers linked)";
  const lines = ["**Linked workers**", ""];
  for (const w of workers) {
    lines.push(`- ${w.status === "working" ? "●" : w.status === "error" ? "✗" : "○"} ${w.name}`);
  }
  return lines.join("\n");
}

// ── Row dispatch ───────────────────────────────────────────

function StaticRowView({ row }: { row: StaticRow }): React.ReactElement | null {
  if (row.kind === "banner") {
    return (
      <Box paddingX={1}>
        <BossBanner subtitle="Orchestrator" hint="talking to all linked projects from one chat" />
      </Box>
    );
  }
  if (row.kind === "user") return <UserMessage text={row.text} />;
  if (row.kind === "assistant") return <AssistantRow item={row} />;
  if (row.kind === "tool") return <ToolHistoryRow item={row} />;
  if (row.kind === "worker_event") return <WorkerEventRow item={row} />;
  if (row.kind === "worker_error") return <WorkerErrorRow item={row} />;
  if (row.kind === "info") return <InfoRow text={row.text} level={row.level ?? "info"} />;
  return null;
}

function AssistantRow({ item }: { item: AssistantItem }): React.ReactElement {
  return (
    <AssistantMessage text={item.text} thinking={item.thinking} thinkingMs={item.thinkingMs} />
  );
}

function ToolHistoryRow({ item }: { item: ToolItem }): React.ReactElement {
  return (
    <ToolExecution
      status="done"
      name={item.name}
      args={item.args}
      result={item.result}
      isError={item.isError}
      details={item.details}
      formatters={bossToolFormatters}
    />
  );
}

// ── Worker rows (gg-boss specific) ─────────────────────────

type WorkerStatusGrade = "DONE" | "UNVERIFIED" | "PARTIAL" | "BLOCKED" | "INFO";

/**
 * Pull the `Status:` line out of a worker's final text (the brief in
 * tools.ts asks every worker to end with one of: DONE | UNVERIFIED |
 * PARTIAL | BLOCKED | INFO). Returns null if the line is missing or invalid.
 */
function parseStatusGrade(text: string): WorkerStatusGrade | null {
  const match = text.match(/^\s*Status:\s*(DONE|UNVERIFIED|PARTIAL|BLOCKED|INFO)\s*$/im);
  if (!match) return null;
  return match[1].toUpperCase() as WorkerStatusGrade;
}

/**
 * Compress the worker's full final-text response down to a single short line.
 * Strips markdown, collapses whitespace, takes the first sentence then hard-caps
 * at `maxLen` so the line never wraps in the MessageResponse gutter. Drops the
 * structured-summary block entirely — its data is shown via the Status badge.
 */
function summarizeFinalText(text: string, maxLen: number): string {
  if (!text) return "";
  // Drop the structured-summary block (Changed/Skipped/Verified/Notes/Status)
  // — that data is surfaced via the Status badge + Notes pulled separately.
  const beforeSummary = text.split(/^Changed:|^Skipped:|^Verified:|^Notes:|^Status:/im)[0];
  const stripped = beforeSummary
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^#+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return "";
  const firstSentence = stripped.match(/^[^.!?\n]+[.!?]/);
  const candidate = firstSentence ? firstSentence[0] : stripped;
  if (candidate.length <= maxLen) return candidate;
  return candidate.slice(0, Math.max(1, maxLen - 1)) + "…";
}

function statusGradeColor(
  grade: WorkerStatusGrade | null,
  theme: ReturnType<typeof useTheme>,
): string {
  switch (grade) {
    case "DONE":
      return theme.success;
    case "UNVERIFIED":
    case "PARTIAL":
      return theme.warning;
    case "BLOCKED":
      return theme.error;
    case "INFO":
      return theme.textDim;
    default:
      return theme.textDim;
  }
}

function WorkerEventRow({ item }: { item: WorkerEventItem }): React.ReactElement {
  const theme = useTheme();
  const { columns } = useTerminalSize();
  const failedCount = item.toolsUsed.filter((t) => !t.ok).length;
  const total = item.toolsUsed.length;
  const grade = parseStatusGrade(item.finalText);
  // Loader status: prefer the worker's self-reported grade. Fall back to
  // tool-error count if the worker omitted Status (older runs / non-conforming).
  const loaderStatus =
    grade === "BLOCKED" || failedCount > 0
      ? "error"
      : grade === "UNVERIFIED" || grade === "PARTIAL"
        ? "queued"
        : "done";
  const headerColor = loaderStatus === "error" ? theme.toolError : theme.toolName;
  const toolSummary =
    total === 0
      ? "no tools"
      : failedCount > 0
        ? `${total} tools (${failedCount} failed)`
        : `${total} tool${total === 1 ? "" : "s"}`;
  // MessageResponse uses 6 chars for "  ⎿  " gutter; reserve a few more for
  // safety (terminal scrollback, "…" suffix). Single-line cap.
  const summaryMaxLen = Math.max(20, columns - 10);
  const summary = summarizeFinalText(item.finalText, summaryMaxLen);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        <ToolUseLoader status={loaderStatus} />
        <Box flexGrow={1}>
          <Text wrap="wrap">
            <Text color={headerColor} bold>
              {item.project}
            </Text>
            <Text color={theme.text}>{`  turn ${item.turnIndex}`}</Text>
            <Text color={theme.textDim}>{`  ·  ${toolSummary}`}</Text>
            {grade && (
              <>
                <Text color={theme.textDim}>{"  ·  "}</Text>
                <Text color={statusGradeColor(grade, theme)} bold>
                  {grade}
                </Text>
              </>
            )}
          </Text>
        </Box>
      </Box>
      {summary && (
        <MessageResponse>
          <Text color={theme.textDim} wrap="truncate">
            {summary}
          </Text>
        </MessageResponse>
      )}
    </Box>
  );
}

function WorkerErrorRow({ item }: { item: WorkerErrorItem }): React.ReactElement {
  const theme = useTheme();
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        <ToolUseLoader status="error" />
        <Box flexGrow={1}>
          <Text wrap="wrap">
            <Text color={theme.toolError} bold>
              {item.project}
            </Text>
            <Text color={theme.textDim}>{"  worker error"}</Text>
          </Text>
        </Box>
      </Box>
      <MessageResponse>
        <Text color={theme.error} wrap="wrap">
          {item.message}
        </Text>
      </MessageResponse>
    </Box>
  );
}

function InfoRow({
  text,
  level,
}: {
  text: string;
  level: "info" | "warning" | "error";
}): React.ReactElement {
  // Render via AssistantMessage so info text gets the same Markdown rendering
  // and dot prefix as any other assistant response — keeping the chat visually
  // consistent.
  if (level === "info") return <AssistantMessage text={text} />;
  const theme = useTheme();
  const color = level === "error" ? theme.error : theme.warning;
  return (
    <Box paddingX={1}>
      <Text color={color}>{text}</Text>
    </Box>
  );
}

// ── Streaming (live) ───────────────────────────────────────

function StreamingTurnView({
  turn,
  isRunning,
}: {
  turn: StreamingTurn;
  isRunning: boolean;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <StreamingArea
        isRunning={isRunning}
        streamingText={turn.text}
        streamingThinking={turn.thinking}
        thinkingMs={turn.thinkingMs}
      />
      {turn.tools.map((t) => (
        <StreamingToolRow key={t.toolCallId} tool={t} />
      ))}
    </Box>
  );
}

function StreamingToolRow({ tool }: { tool: StreamingTool }): React.ReactElement {
  if (tool.status === "running") {
    return (
      <ToolExecution
        status="running"
        name={tool.name}
        args={tool.args}
        formatters={bossToolFormatters}
      />
    );
  }
  return (
    <ToolExecution
      status="done"
      name={tool.name}
      args={tool.args}
      result={tool.result ?? ""}
      isError={tool.status === "error"}
      details={tool.details}
      formatters={bossToolFormatters}
    />
  );
}

// ── Renderer ───────────────────────────────────────────────

export interface RenderBossAppOptions {
  boss: GGBoss;
}

export function renderBossApp(opts: RenderBossAppOptions): {
  waitUntilExit: () => Promise<void>;
  unmount: () => void;
} {
  // Disable Ink's built-in exit-on-Ctrl+C — we need our own double-press
  // handler in BossApp to drive the "Press Ctrl+C again to exit" footer
  // message. With this flag true (the default), Ink kills the process on the
  // very first Ctrl+C and InputArea's onAbort never runs.
  const instance = render(<BossApp boss={opts.boss} />, { exitOnCtrlC: false });
  return {
    waitUntilExit: async () => {
      await instance.waitUntilExit();
    },
    unmount: () => instance.unmount(),
  };
}
