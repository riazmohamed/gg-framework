import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Static, Text, useApp } from "ink";
import {
  ActivityIndicator,
  AssistantMessage,
  Footer,
  InputArea,
  ModelSelector,
  StreamingArea,
  ToolExecution,
  UserMessage,
  deriveFrame,
  useAnimationTick,
} from "@kenkaiiii/ggcoder/ui";
import { useTerminalSize } from "@kenkaiiii/ggcoder/ui/hooks/terminal-size";
import { useAgentLoop } from "@kenkaiiii/ggcoder/ui/hooks/agent-loop";
import { useDoublePress } from "@kenkaiiii/ggcoder/ui/hooks/double-press";
import { useTheme } from "@kenkaiiii/ggcoder/ui/theme";
import type { Message, Provider } from "@kenkaiiii/gg-ai";
import type { AgentTool } from "@kenkaiiii/gg-agent";
import { Banner } from "./components/Banner.js";
import { createHost, detectHost } from "../core/hosts/index.js";
import { saveSession } from "../core/sessions.js";

// Editor brand pulse — amber → orange → rose. Distinct from ggcoder's blue/purple.
const THINKING_BORDER_COLORS = ["#fbbf24", "#f97316", "#ec4899", "#f97316", "#fbbf24"];

export interface AppProps {
  /**
   * Provider + model + auth — passed straight to useAgentLoop. Avoids needing
   * a fully-constructed Agent (hook manages its own loop internally).
   */
  provider: Provider;
  model: string;
  apiKey: string;
  accountId?: string;
  tools: AgentTool[];
  systemPrompt: string;
  /** Prior messages for resume; empty array for fresh session. */
  priorMessages: Message[];

  hostName: string;
  hostDisplayName: string;
  hostAvailable: boolean;
  hostReason?: string;
  cwd: string;
  /** Package version for the banner. */
  version: string;
  /** Providers the user has credentials for — used by /model selector. */
  loggedInProviders: Provider[];

  /** Persist session for `ggeditor continue` after each completed turn. */
  persistSessions?: boolean;
  onShutdown: () => void;
}

/**
 * Items that go into <Static> — user / assistant / completed-tool only. They
 * are printed once and then become normal terminal scrollback. Running tool
 * calls render OUTSIDE Static (from agentLoop.activeToolCalls) so they don't
 * pollute scrollback while in flight.
 */
type HistoryItem =
  | { id: number; kind: "user"; text: string }
  | {
      id: number;
      kind: "assistant";
      text: string;
      thinking?: string;
      thinkingMs?: number;
    }
  | {
      id: number;
      kind: "tool_done";
      toolCallId: string;
      name: string;
      args: Record<string, unknown>;
      result: string;
      isError: boolean;
      details?: unknown;
    };

// Names are bare (no `/` prefix) — ggcoder's slash menu prepends `/` for
// display. Including a `/` here would render as `//`.
const EDITOR_COMMANDS = [
  { name: "model", aliases: ["m"], description: "switch model" },
  { name: "help", aliases: ["?"], description: "show available commands" },
  { name: "clear", aliases: [], description: "clear visible history (doesn't reset agent)" },
  { name: "quit", aliases: ["exit", "q"], description: "exit cleanly" },
];

export function App(props: AppProps) {
  const { exit } = useApp();
  const theme = useTheme();
  const { columns } = useTerminalSize();
  const animTick = useAnimationTick();

  // The rolling messages array — passed to useAgentLoop as a ref. Seeded
  // with [system, ...priorMessages] for fresh sessions or resumes.
  const messagesRef = useRef<Message[]>([
    { role: "system", content: props.systemPrompt },
    ...props.priorMessages,
  ]);

  // Completed items rendered into <Static> — user / assistant / tool_done.
  // Each item is printed once and then becomes normal terminal scrollback,
  // which is what restores upward scrolling.
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>(() =>
    props.priorMessages.flatMap((m, i) => messageToHistoryItems(m, i)),
  );
  const idCounter = useRef(props.priorMessages.length + 100);
  const lastUserMessageRef = useRef<string>("");
  const [lastUserMessage, setLastUserMessage] = useState<string>("");
  const [exitPending, setExitPending] = useState(false);

  // Live model + thinking state — swappable via /model and Shift-Tab.
  const [currentProvider, setCurrentProvider] = useState<Provider>(props.provider);
  const [currentModel, setCurrentModel] = useState<string>(props.model);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);

  // Overlay state — currently only the model selector.
  const [overlay, setOverlay] = useState<"model" | null>(null);

  // Live host status — polled every 3s so the banner + footer reflect the
  // user opening/closing Resolve or Premiere mid-session.
  const [hostStatus, setHostStatus] = useState({
    name: props.hostName,
    displayName: props.hostDisplayName,
    available: props.hostAvailable,
    reason: props.hostReason,
  });

  // Live timeline glance — only fetched when host is connected. Cheap
  // bridge call that returns name/fps/duration/clip count.
  const [timelineGlance, setTimelineGlance] = useState<{
    name: string;
    fps: number;
    durationFrames: number;
    clips: number;
    markers: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const detected = detectHost();
      const fresh = createHost(detected.name === "none" ? "none" : detected.name);
      try {
        const caps = await fresh.capabilities();
        if (cancelled) return;
        setHostStatus((prev) => {
          const next = {
            name: fresh.name,
            displayName: fresh.displayName,
            available: caps.isAvailable,
            reason: caps.unavailableReason,
          };
          if (
            prev.name === next.name &&
            prev.available === next.available &&
            prev.reason === next.reason
          ) {
            return prev;
          }
          return next;
        });

        // Only fetch timeline when host is connected. Cheap (~30ms) but
        // still pointless if nothing's there.
        if (caps.isAvailable && fresh.name !== "none") {
          try {
            const t = await fresh.getTimeline();
            if (cancelled) return;
            setTimelineGlance({
              name: t.name,
              fps: t.frameRate,
              durationFrames: t.durationFrames,
              clips: t.clips.length,
              markers: t.markers.length,
            });
          } catch {
            // No project / no timeline open. Clear stale glance.
            if (!cancelled) setTimelineGlance(null);
          }
        } else {
          if (!cancelled) setTimelineGlance(null);
        }
      } catch {
        /* ignore */
      }
    };
    void tick(); // run once immediately
    const interval = setInterval(() => {
      void tick();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [props.hostName]);

  const nextId = () => ++idCounter.current;

  // ── useAgentLoop wires streaming, retries, thinking, etc. ───────────
  const agentLoop = useAgentLoop(
    messagesRef,
    {
      provider: currentProvider,
      model: currentModel,
      tools: props.tools,
      maxTokens: 16384,
      apiKey: props.apiKey,
      accountId: props.accountId,
      thinking: thinkingEnabled ? "medium" : undefined,
    },
    {
      onTurnText: (text, thinking, thinkingMs) => {
        if (text.trim().length === 0) return;
        setHistoryItems((items) => [
          ...items,
          {
            id: nextId(),
            kind: "assistant",
            text,
            thinking: thinking || undefined,
            thinkingMs: thinkingMs || undefined,
          },
        ]);
      },
      // Running tool calls are rendered live from agentLoop.activeToolCalls
      // OUTSIDE of <Static>; only the completed result enters scrollback here.
      onToolEnd: (toolCallId, name, result, isError, _durationMs, details) => {
        const active = agentLoop.activeToolCalls.find((tc) => tc.toolCallId === toolCallId);
        setHistoryItems((items) => [
          ...items,
          {
            id: nextId(),
            kind: "tool_done",
            toolCallId,
            name,
            args: active?.args ?? {},
            result,
            isError,
            details,
          },
        ]);
      },
      onComplete: () => {
        if (!props.persistSessions) return;
        const persisted = messagesRef.current.filter((m) => m.role !== "system");
        void saveSession({
          provider: currentProvider,
          model: currentModel,
          cwd: props.cwd,
          host: props.hostName,
          messages: persisted,
        }).catch(() => {
          /* best effort */
        });
      },
    },
  );

  // ── Slash + submit handling ─────────────────────────────────────────
  const handleSubmit = useCallback(
    (value: string) => {
      // Local slash commands.
      if (value === "/quit" || value === "/exit" || value === "/q") {
        props.onShutdown();
        exit();
        return;
      }
      if (value === "/clear") {
        setHistoryItems([]);
        return;
      }
      if (value === "/help" || value === "/?") {
        setHistoryItems((items) => [
          ...items,
          {
            id: nextId(),
            kind: "assistant",
            text:
              "**Slash commands**\n\n" +
              "- `/model` `/m` — switch model\n" +
              "- `/quit` `/exit` `/q` — exit\n" +
              "- `/clear` — clear visible history (doesn't reset agent)\n" +
              "- `/help` `/?` — this help\n\n" +
              "**Keys**\n\n" +
              "- `Shift-Tab` toggle thinking\n" +
              "- `ESC` interrupt the agent\n" +
              "- `Ctrl-C` (twice) exit\n\n" +
              "**Resume**\n\n" +
              "- `ggeditor continue` — pick up the most recent session\n",
          },
        ]);
        return;
      }
      if (value === "/model" || value === "/m") {
        setOverlay("model");
        return;
      }

      lastUserMessageRef.current = value;
      setLastUserMessage(value);
      setHistoryItems((items) => [...items, { id: nextId(), kind: "user", text: value }]);
      void agentLoop.run(value);
    },
    [agentLoop, exit, props],
  );

  // Double-press exit — first Ctrl+C / ESC sets pending; second within 800ms
  // exits cleanly. Mirrors ggcoder's pattern.
  const handleDoubleExit = useDoublePress(setExitPending, () => {
    props.onShutdown();
    exit();
  });

  // Toggle thinking via Shift-Tab — same binding ggcoder uses.
  const handleToggleThinking = useCallback(() => {
    setThinkingEnabled((prev) => {
      const next = !prev;
      setHistoryItems((items) => [
        ...items,
        {
          id: nextId(),
          kind: "assistant",
          text: next ? "_Thinking enabled._" : "_Thinking disabled._",
        },
      ]);
      return next;
    });
  }, []);

  // Apply a /model selection.
  const handleModelSelect = useCallback((modelId: string) => {
    // ModelSelector hands us a bare model id; provider is implicit. Look it
    // up in the registry to know which provider to switch to.
    import("@kenkaiiii/ggcoder/models").then(({ getModel }) => {
      const info = getModel(modelId);
      if (info) {
        setCurrentProvider(info.provider as Provider);
        setCurrentModel(modelId);
        setHistoryItems((items) => [
          ...items,
          {
            id: nextId(),
            kind: "assistant",
            text: `_Switched to **${info.name}**._`,
          },
        ]);
      }
      setOverlay(null);
    });
  }, []);

  // ESC / Ctrl+C from InputArea: abort if running, else double-press to exit.
  const handleAbort = useCallback(() => {
    if (agentLoop.isRunning) {
      agentLoop.abort();
    } else {
      handleDoubleExit();
    }
  }, [agentLoop, handleDoubleExit]);

  // SIGINT from outside InputArea (rare — most input events go through Ink's
  // useInput inside InputArea). Still wire it as a safety net.
  useEffect(() => {
    const onSig = () => handleAbort();
    process.on("SIGINT", onSig);
    return () => {
      process.off("SIGINT", onSig);
    };
  }, [handleAbort]);

  // Animated thinking border frame
  const thinkingBorderFrame = useMemo(
    () =>
      agentLoop.activityPhase === "thinking"
        ? deriveFrame(animTick, 1000, THINKING_BORDER_COLORS.length)
        : 0,
    [agentLoop.activityPhase, animTick],
  );

  // Static items: banner + completed history. Each entry is rendered exactly
  // once into the terminal scrollback by Ink. Critical: this is what restores
  // upward scrolling — nothing in <Static> gets re-rendered, so Ink doesn't
  // pin the cursor to the bottom on every state update.
  const staticItems = useMemo(
    () => [
      {
        id: "banner",
        el: <Banner version={props.version} model={currentModel} provider={currentProvider} />,
      },
      ...historyItems.map((item) => ({ id: `h${item.id}`, el: renderItem(item) })),
    ],
    // Banner is static — host connection state lives in the Footer (which
    // polls every few seconds and updates live).
    [historyItems, props.version, currentModel, currentProvider],
  );

  return (
    <Box flexDirection="column">
      <Static items={staticItems}>{(item) => <Box key={item.id}>{item.el}</Box>}</Static>

      {/* Streaming live text + thinking */}
      <StreamingArea
        isRunning={agentLoop.isRunning}
        streamingText={agentLoop.streamingText}
        streamingThinking={agentLoop.streamingThinking}
        showThinking
        thinkingMs={agentLoop.thinkingMs}
      />

      {/* Live tool calls in flight (rendered OUTSIDE Static so they update). */}
      {agentLoop.activeToolCalls.map((tc) => (
        <ToolExecution key={tc.toolCallId} status="running" name={tc.name} args={tc.args} />
      ))}

      {/* Pinned activity indicator (the "thinking bar"). */}
      {agentLoop.isRunning && agentLoop.activityPhase !== "idle" ? (
        <Box
          marginTop={1}
          borderStyle="round"
          borderColor={
            agentLoop.activityPhase === "thinking"
              ? THINKING_BORDER_COLORS[thinkingBorderFrame]
              : "transparent"
          }
          paddingLeft={1}
          paddingRight={1}
          width={columns}
        >
          <ActivityIndicator
            phase={agentLoop.activityPhase}
            elapsedMs={agentLoop.elapsedMs}
            runStartRef={agentLoop.runStartRef}
            thinkingMs={agentLoop.thinkingMs}
            isThinking={agentLoop.isThinking}
            tokenEstimate={agentLoop.streamedTokenEstimate}
            charCountRef={agentLoop.charCountRef}
            realTokensAccumRef={agentLoop.realTokensAccumRef}
            userMessage={lastUserMessage}
            activeToolNames={agentLoop.activeToolCalls.map((tc) => tc.name)}
            retryInfo={agentLoop.retryInfo}
          />
        </Box>
      ) : agentLoop.stallError ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.warning}>
            {"⚠ Stream interrupted — retries exhausted. Your conversation is preserved."}
          </Text>
        </Box>
      ) : null}

      {/* Model picker overlay (rendered between input and history when active). */}
      {overlay === "model" ? (
        <ModelSelector
          onSelect={handleModelSelect}
          onCancel={() => setOverlay(null)}
          loggedInProviders={props.loggedInProviders}
          currentModel={currentModel}
          currentProvider={currentProvider}
        />
      ) : null}

      {/* Input */}
      <InputArea
        onSubmit={(value) => handleSubmit(value)}
        onAbort={handleAbort}
        disabled={agentLoop.isRunning}
        isActive={overlay === null}
        onShiftTab={handleToggleThinking}
        cwd={props.cwd}
        commands={EDITOR_COMMANDS}
      />

      {/* Footer */}
      <Footer
        model={currentModel}
        tokensIn={agentLoop.contextUsed}
        cwd={props.cwd}
        thinkingEnabled={thinkingEnabled}
        hidePlan
        hideCwd
        hideGitBranch
        exitPending={exitPending}
        statusLabel={composeStatusLabel(hostStatus, timelineGlance)}
        statusColor={composeStatusColor(hostStatus, theme)}
      />
    </Box>
  );
}

function composeStatusLabel(
  status: { name: string; displayName: string; available: boolean },
  timeline: {
    name: string;
    fps: number;
    durationFrames: number;
    clips: number;
    markers: number;
  } | null,
): string | undefined {
  if (status.name === "none") return undefined;
  const short = status.name === "resolve" ? "DaVinci Resolve" : "Premiere Pro";
  if (!status.available) return `Disconnected from ${short}`;

  if (!timeline) return `Connected to ${short}`;

  // Compose: "Connected to DaVinci Resolve · Episode 47 (29.97 · 1h24m · 127 clips)"
  const fpsLabel = formatFps(timeline.fps);
  const durLabel = formatDuration(timeline.durationFrames, timeline.fps);
  const clipsLabel = `${timeline.clips} clip${timeline.clips === 1 ? "" : "s"}`;
  return `Connected to ${short} · ${timeline.name} (${fpsLabel} · ${durLabel} · ${clipsLabel})`;
}

function composeStatusColor(
  status: { name: string; available: boolean },
  theme: ReturnType<typeof useTheme>,
): string | undefined {
  if (status.name === "none") return undefined;
  return status.available ? theme.success : theme.warning;
}

function formatFps(fps: number): string {
  // Snap common NTSC values to their named form.
  if (Math.abs(fps - 23.976) < 0.01) return "23.976";
  if (Math.abs(fps - 29.97) < 0.01) return "29.97";
  if (Math.abs(fps - 59.94) < 0.01) return "59.94";
  return fps.toFixed(fps % 1 === 0 ? 0 : 2);
}

function formatDuration(frames: number, fps: number): string {
  if (fps <= 0) return "0s";
  const totalSec = Math.round(frames / fps);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h${m.toString().padStart(2, "0")}m`;
  if (m > 0) return `${m}m${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

function renderItem(item: HistoryItem): React.JSX.Element {
  if (item.kind === "user") {
    return <UserMessage key={item.id} text={item.text} />;
  }
  if (item.kind === "assistant") {
    return (
      <AssistantMessage
        key={item.id}
        text={item.text}
        thinking={item.thinking}
        thinkingMs={item.thinkingMs}
        showThinking
      />
    );
  }
  // tool_done
  return (
    <ToolExecution
      key={item.id}
      status="done"
      name={item.name}
      args={item.args}
      result={item.result}
      isError={item.isError}
      details={item.details}
    />
  );
}

/** Convert a persisted Message into HistoryItems for resume display. */
function messageToHistoryItems(msg: Message, baseId: number): HistoryItem[] {
  const id = baseId * 10 + 1;
  if (msg.role === "user") {
    const text =
      typeof msg.content === "string"
        ? msg.content
        : msg.content
            .filter((c): c is { type: "text"; text: string } => "text" in c && c.type === "text")
            .map((c) => c.text)
            .join("\n");
    if (!text) return [];
    return [{ id, kind: "user", text }];
  }
  if (msg.role === "assistant") {
    if (typeof msg.content === "string") {
      return msg.content ? [{ id, kind: "assistant", text: msg.content }] : [];
    }
    const items: HistoryItem[] = [];
    let textBuf = "";
    for (const block of msg.content) {
      if ("text" in block && block.type === "text") {
        textBuf += (textBuf ? "\n" : "") + block.text;
      } else if ("name" in block && block.type === "tool_call") {
        if (textBuf) {
          items.push({ id: id + items.length, kind: "assistant", text: textBuf });
          textBuf = "";
        }
        items.push({
          id: id + items.length,
          kind: "tool_done",
          toolCallId: block.id,
          name: block.name,
          args: block.args ?? {},
          result: "",
          isError: false,
        });
      }
    }
    if (textBuf) items.push({ id: id + items.length, kind: "assistant", text: textBuf });
    return items;
  }
  return [];
}
