import React, { useEffect, useMemo, useRef } from "react";
import { Box, Static, Text, render, useApp } from "ink";
import { ThemeContext, loadTheme } from "@kenkaiiii/ggcoder/ui/theme";
import {
  AnimationProvider,
  AssistantMessage,
  InputArea,
  StreamingArea,
  ToolExecution,
  UserMessage,
  Spinner,
} from "@kenkaiiii/ggcoder/ui";
import { TerminalSizeProvider } from "@kenkaiiii/ggcoder/ui/hooks/terminal-size";
import { BossBanner } from "./banner.js";
import { BossFooter } from "./boss-footer.js";
import { COLORS } from "./branding.js";
import { bossStore, useBossState } from "./boss-store.js";
import type {
  HistoryItem,
  StreamingTool,
  StreamingTurn,
  ToolItem,
  WorkerEventItem,
  WorkerErrorItem,
} from "./boss-store.js";
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
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const staticItems: StaticRow[] = useMemo(
    () => [{ kind: "banner", id: "banner" }, ...state.history],
    [state.history],
  );

  useEffect(() => {
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, []);

  // Two-phase flush: when the orchestrator/worker pushes items into pendingFlush
  // (which shrinks the live streaming area in phase 1), commit them to history
  // here on a separate render cycle. Running this in useEffect — AFTER React
  // has painted the prior render that collapsed the live area — guarantees Ink's
  // log-update doesn't have to clear a tall live area AND write new Static lines
  // in the same frame, which is what was clipping long final responses.
  useEffect(() => {
    if (state.pendingFlush.length > 0) {
      bossStore.commitPendingFlush();
    }
  }, [state.flushGeneration, state.pendingFlush.length]);

  const handleSubmit = (value: string): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    bossStore.appendUser(trimmed);
    boss.enqueueUserMessage(trimmed);
  };

  const handleAbort = (): void => {
    if (state.exitPending) {
      exit();
      return;
    }
    bossStore.setExitPending(true);
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    exitTimerRef.current = setTimeout(() => bossStore.setExitPending(false), 2000);
  };

  return (
    <Box flexDirection="column">
      <Static items={staticItems}>{(item) => <StaticRowView key={item.id} row={item} />}</Static>

      {state.streaming && (
        <StreamingTurnView turn={state.streaming} isRunning={state.phase === "working"} />
      )}
      {state.phase === "working" && !state.streaming?.text && !state.streaming?.tools.length && (
        <ActivityRow />
      )}

      <InputArea
        onSubmit={handleSubmit}
        onAbort={handleAbort}
        disabled={state.phase === "working"}
        cwd={process.cwd()}
        commands={[]}
      />

      <BossFooter
        workers={state.workers}
        bossModel={state.bossModel}
        workerModel={state.workerModel}
        pendingUserMessages={state.pendingUserMessages}
        exitPending={state.exitPending}
      />
    </Box>
  );
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
  if (row.kind === "assistant") return <AssistantMessage text={row.text} />;
  if (row.kind === "tool") return <ToolHistoryRow item={row} />;
  if (row.kind === "worker_event") return <WorkerEventRow item={row} />;
  if (row.kind === "worker_error") return <WorkerErrorRow item={row} />;
  if (row.kind === "info") return <InfoRow text={row.text} level={row.level ?? "info"} />;
  return null;
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
    />
  );
}

// ── Worker rows (gg-boss-specific — no ggcoder equivalent) ─

function WorkerEventRow({ item }: { item: WorkerEventItem }): React.ReactElement {
  const tools =
    item.toolsUsed.length > 0
      ? item.toolsUsed.map((t) => (t.ok ? t.name : `${t.name}✗`)).join(", ")
      : "(no tools)";
  return (
    <Box paddingX={1} marginTop={1} flexDirection="column">
      <Box>
        <Text color={COLORS.success}>{"▸ "}</Text>
        <Text color={COLORS.primary} bold>
          {item.project}
        </Text>
        <Text color={COLORS.textDim}>{`  turn ${item.turnIndex}  ·  ${tools}`}</Text>
      </Box>
      {item.finalText && (
        <Box paddingLeft={2}>
          <Text color={COLORS.textDim}>{item.finalText}</Text>
        </Box>
      )}
    </Box>
  );
}

function WorkerErrorRow({ item }: { item: WorkerErrorItem }): React.ReactElement {
  return (
    <Box paddingX={1} marginTop={1} flexDirection="column">
      <Box>
        <Text color={COLORS.error}>{"✗ "}</Text>
        <Text color={COLORS.error} bold>
          {item.project}
        </Text>
        <Text color={COLORS.textDim}>{"  worker error"}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text color={COLORS.error}>{item.message}</Text>
      </Box>
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
  const color =
    level === "error" ? COLORS.error : level === "warning" ? COLORS.warning : COLORS.textDim;
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
      <StreamingArea isRunning={isRunning} streamingText={turn.text} streamingThinking="" />
      {turn.tools.map((t) => (
        <StreamingToolRow key={t.toolCallId} tool={t} />
      ))}
    </Box>
  );
}

function StreamingToolRow({ tool }: { tool: StreamingTool }): React.ReactElement {
  if (tool.status === "running") {
    return <ToolExecution status="running" name={tool.name} args={tool.args} />;
  }
  return (
    <ToolExecution
      status="done"
      name={tool.name}
      args={tool.args}
      result={tool.result ?? ""}
      isError={tool.status === "error"}
      details={tool.details}
    />
  );
}

function ActivityRow(): React.ReactElement {
  return (
    <Box paddingX={1} marginTop={1}>
      <Spinner />
      <Text color={COLORS.textDim}> Boss thinking…</Text>
    </Box>
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
  const instance = render(<BossApp boss={opts.boss} />);
  return {
    waitUntilExit: async () => {
      await instance.waitUntilExit();
    },
    unmount: () => instance.unmount(),
  };
}
