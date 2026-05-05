import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Static, Text, render, useApp, useInput } from "ink";
import { ThemeContext, loadTheme, useTheme } from "@abukhaled/ogcoder/ui/theme";
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
} from "@abukhaled/ogcoder/ui";
import { useDoublePress } from "@abukhaled/ogcoder/ui/hooks/double-press";
import type { Provider } from "@abukhaled/gg-ai";
import { TerminalSizeProvider, useTerminalSize } from "@abukhaled/ogcoder/ui/hooks/terminal-size";
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
import { projectColor } from "./colors.js";
import { BOSS_PHRASES } from "./boss-phrases.js";
import { COLORS, PULSE_COLORS as BOSS_PULSE_COLORS } from "./branding.js";
import { BossTasksOverlay } from "./boss-tasks-overlay.js";
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
  // Live char count of the current streaming text — drives ActivityIndicator's
  // smooth token-counter animation between turn_end events.
  const charCountRef = useRef<number>(0);
  charCountRef.current = state.streaming?.text.length ?? 0;
  // Accumulated real input tokens across completed turns — used alongside
  // charCountRef so the counter interpolates smoothly between hard updates.
  const realTokensAccumRef = useRef<number>(0);
  realTokensAccumRef.current = state.bossInputTokens;
  // Track the most recent user message so the activity bar's contextual phrase
  // selection has something to riff on (when not using BOSS_PHRASES override).
  const [lastUserMessage, setLastUserMessage] = useState<string>("");
  const [overlay, setOverlay] = useState<"model-boss" | "model-workers" | "tasks" | null>(null);

  const staticItems: StaticRow[] = useMemo(
    () => [{ kind: "banner", id: "banner" }, ...state.history],
    [state.history],
  );

  /**
   * Just toggles overlay state. We deliberately do NOT clear the screen or
   * remount Static here — both of those caused the banner to be reprinted to
   * scrollback on every toggle, leaving multiple banner copies above when the
   * user scrolls up. Ink's log-update handles live-area swaps cleanly on its
   * own; the Static block stays put in scrollback as it should.
   */
  const toggleOverlay = useCallback(
    (next: "tasks" | "model-boss" | "model-workers" | null): void => {
      setOverlay(next);
    },
    [],
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

  // ── App-level keyboard ──────────────────────────────────
  // ESC: abort current boss call when working (InputArea handles otherwise).
  // Ctrl+T: toggle the Tasks overlay (matches ggcoder's keybind).
  useInput((input, key) => {
    if (key.ctrl && input === "t") {
      toggleOverlay(overlay === "tasks" ? null : "tasks");
      return;
    }
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
        toggleOverlay("model-boss");
        return true;
      case "model-workers":
        toggleOverlay("model-workers");
        return true;
      case "compact":
        bossStore.appendUser(value);
        await boss.manualCompact();
        return true;
      case "tasks":
        toggleOverlay("tasks");
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
      toggleOverlay(null);
      return;
    }
    const provider = value.slice(0, colon) as Provider;
    const model = value.slice(colon + 1);
    if (overlay === "model-boss") {
      void boss.switchBossModel(provider, model);
    } else if (overlay === "model-workers") {
      void boss.switchWorkerModel(provider, model);
    }
    toggleOverlay(null);
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
    setLastUserMessage(trimmed);
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

  // Tasks overlay is a full-screen view: render Static (pinned banner +
  // history) then ONLY the overlay below it, no streaming/input/footer. This
  // mirrors ggcoder's isTaskView pattern — embedding the overlay alongside
  // the chat chrome makes the input + footer visibly shift on each toggle.
  if (overlay === "tasks") {
    return (
      <Box flexDirection="column">
        <Static items={staticItems}>{(item) => <StaticRowView key={item.id} row={item} />}</Static>
        <BossTasksOverlay boss={boss} workers={state.workers} onClose={() => toggleOverlay(null)} />
      </Box>
    );
  }

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
            charCountRef={charCountRef}
            realTokensAccumRef={realTokensAccumRef}
            userMessage={lastUserMessage}
            activeToolNames={(state.streaming?.tools ?? [])
              .filter((t) => t.status === "running")
              .map((t) => t.name)}
            retryInfo={state.retryInfo}
            phrases={BOSS_PHRASES}
            pulseColors={BOSS_PULSE_COLORS}
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

      {overlay === "model-boss" || overlay === "model-workers" ? (
        <ModelSelector
          onSelect={handleModelSelect}
          onCancel={() => toggleOverlay(null)}
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
  const isAll = scope === "all";
  // "All" → boss accent (fuchsia) so multi-project mode wears the brand.
  // Specific project → its stable project color so the pill matches its
  // appearances elsewhere in the TUI.
  const bg = isAll ? COLORS.accent : projectColor(scope);
  const label = isAll ? "All" : scope;
  // Black text reads cleanly on every color in the palette — the project hues
  // are deliberately light/saturated, which is unreadable with white on top.
  return (
    <Text color="black" backgroundColor={bg} bold>
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
        // Glyph color tracks status. Name color tracks PROJECT — same hue as
        // the worker event row + scope pill — so each project is instantly
        // identifiable. Errored workers turn red entirely.
        const errored = w.status === "error";
        const glyphColor = errored
          ? theme.error
          : w.status === "working"
            ? projectColor(w.name)
            : theme.textDim;
        const nameColor = errored ? theme.error : projectColor(w.name);
        return (
          <React.Fragment key={w.name}>
            {i > 0 && <Text color={theme.textDim}>{"  "}</Text>}
            <Text color={glyphColor}>{WORKER_GLYPH[w.status]} </Text>
            <Text color={nameColor} bold={w.status === "working"} dimColor={w.status === "idle"}>
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
        <BossBanner subtitle="Orchestrator" showShortcuts />
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
  // Errors override the project hue with red; otherwise the project gets its
  // stable color so successive turns from the same worker visually cluster.
  const headerColor = loaderStatus === "error" ? theme.toolError : projectColor(item.project);
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
  // info → render through AssistantMessage so it gets the dot + Markdown.
  if (level === "info") return <AssistantMessage text={text} />;
  // warning / error → match the ToolUseLoader chrome so the row reads as a
  // first-class event (consistent with worker errors / failed tool calls)
  // rather than bare colored text.
  const theme = useTheme();
  const color = level === "error" ? theme.error : theme.warning;
  return (
    <Box marginTop={1} flexDirection="row">
      <ToolUseLoader status={level === "error" ? "error" : "queued"} />
      <Box flexGrow={1}>
        <Text color={color} wrap="wrap">
          {text}
        </Text>
      </Box>
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
