import React, { useCallback, useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { useTheme } from "../theme/theme.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import {
  readJournal,
  readManifest,
  updateEntry,
  type JournalEntry,
  type ProbeEntry,
} from "@kenkaiiii/ggcoder-eyes";

// ── Navigable row model ───────────────────────────────────
// Flatten probes + signals into a single navigable list so arrow keys and
// j/k don't get stuck on section boundaries. Section headers render inline
// but aren't part of the row array.

type Row = { kind: "probe"; probe: ProbeEntry } | { kind: "signal"; entry: JournalEntry };

// ── Logo ──────────────────────────────────────────────────

const EYES_LOGO = [" ▄▄▄  ▄▄▄ ", " █●█  █●█ ", " ▀▀▀  ▀▀▀ "];

const GRADIENT = [
  "#60a5fa",
  "#7dabfa",
  "#9ab1fa",
  "#a78bfa",
  "#c1a9f4",
  "#a78bfa",
  "#9ab1fa",
  "#7dabfa",
];

const GAP = "   ";
const LOGO_WIDTH = 11;
const SIDE_BY_SIDE_MIN = LOGO_WIDTH + GAP.length + 20;

function EyesGradientText({ text }: { text: string }) {
  const chars: React.ReactNode[] = [];
  let colorIdx = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === " ") {
      chars.push(ch);
    } else {
      const color = GRADIENT[colorIdx % GRADIENT.length];
      chars.push(
        <Text key={i} color={color}>
          {ch}
        </Text>,
      );
      colorIdx++;
    }
  }
  return <Text>{chars}</Text>;
}

// ── CLI resolution ────────────────────────────────────────
// Find the ggcoder-eyes CLI binary for `verify` action. Works in workspace dev
// installs and in globally-installed npm packages because we resolve through
// the package graph rather than relying on $PATH.

const requireFn = createRequire(import.meta.url);
let cachedCliPath: string | null = null;
function resolveCli(): string | null {
  if (cachedCliPath) return cachedCliPath;
  try {
    cachedCliPath = requireFn.resolve("@kenkaiiii/ggcoder-eyes/cli");
    return cachedCliPath;
  } catch {
    return null;
  }
}

// ── Formatting helpers ────────────────────────────────────

function relTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function probeStatusGlyph(status: ProbeEntry["status"]): string {
  switch (status) {
    case "verified":
      return "✓";
    case "failed":
      return "✗";
    default:
      return "·";
  }
}

function signalGlyph(kind: JournalEntry["kind"]): string {
  switch (kind) {
    case "blocked":
      return "⛔";
    case "wish":
      return "✨";
    default:
      return "⚠";
  }
}

// ── Component ─────────────────────────────────────────────

interface EyesOverlayProps {
  cwd: string;
  onClose: () => void;
  /** Inject a user message into the current agent stream — used by `[i]mprove`
   * and `[a]dd` so the pane doesn't restart the session. */
  onQueueMessage: (message: string) => void;
}

export function EyesOverlay({ cwd, onClose, onQueueMessage }: EyesOverlayProps) {
  const theme = useTheme();
  const { columns } = useTerminalSize();

  const [probes, setProbes] = useState<ProbeEntry[]>([]);
  const [signals, setSignals] = useState<JournalEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const reload = useCallback(() => {
    setProbes(readManifest(cwd).probes);
    setSignals(readJournal({ status: "open", order: "desc" }, cwd));
  }, [cwd]);

  useEffect(() => {
    reload();
  }, [reload]);

  const rows: Row[] = [
    ...probes.map<Row>((probe) => ({ kind: "probe", probe })),
    ...signals.map<Row>((entry) => ({ kind: "signal", entry })),
  ];

  // Clamp selection when rows change
  useEffect(() => {
    if (rows.length === 0) setSelectedIndex(0);
    else if (selectedIndex >= rows.length) setSelectedIndex(rows.length - 1);
  }, [rows.length, selectedIndex]);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (key.upArrow || input === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1));
      setExpandedKey(null);
      return;
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((i) => Math.min(rows.length - 1, i + 1));
      setExpandedKey(null);
      return;
    }

    if (key.return || input === " ") {
      const row = rows[selectedIndex];
      if (!row) return;
      const rowKey = row.kind === "probe" ? `p:${row.probe.name}` : `s:${row.entry.id}`;
      setExpandedKey((prev) => (prev === rowKey ? null : rowKey));
      return;
    }

    // Actions — single-keypress
    if (input === "i") {
      onQueueMessage("/eyes-improve");
      onClose();
      return;
    }
    if (input === "a") {
      onQueueMessage("/eyes");
      onClose();
      return;
    }
    if (input === "v") {
      const cli = resolveCli();
      if (!cli) {
        setStatus("ggcoder-eyes CLI not found");
        return;
      }
      setStatus("verifying…");
      const r = spawnSync(process.execPath, [cli, "verify"], { cwd, stdio: "ignore" });
      setStatus(r.status === 0 ? "verify done" : `verify exit ${r.status}`);
      reload();
      return;
    }

    // Signal-only actions
    const row = rows[selectedIndex];
    if (!row || row.kind !== "signal") return;
    if (input === "d") {
      updateEntry(row.entry.id, { status: "deferred" }, cwd);
      setStatus(`deferred ${row.entry.id}`);
      reload();
      return;
    }
    if (input === "x") {
      updateEntry(row.entry.id, { status: "acked" }, cwd);
      setStatus(`dismissed ${row.entry.id}`);
      reload();
      return;
    }
  });

  // ── Rendering helpers ──────────────────────────────────

  const maxVisible = 15;
  const startIdx = Math.max(0, selectedIndex - maxVisible + 1);
  const visibleRows = rows.slice(startIdx, startIdx + maxVisible);

  const home = process.env.HOME ?? "";
  const displayPath = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
  const verifiedCount = probes.filter((p) => p.status === "verified").length;
  const failedCount = probes.filter((p) => p.status === "failed").length;

  // Section header preceding the first signal row (if any) — we track which
  // visible index is the first signal to insert a divider.
  const firstSignalVisibleIdx = (() => {
    for (let i = 0; i < visibleRows.length; i++) {
      if (visibleRows[i].kind === "signal") return i;
    }
    return -1;
  })();

  return (
    <Box flexDirection="column">
      {/* Banner */}
      {columns < SIDE_BY_SIDE_MIN ? (
        <Box flexDirection="column" marginTop={1} marginBottom={1} width={columns}>
          <EyesGradientText text={EYES_LOGO[0]} />
          <EyesGradientText text={EYES_LOGO[1]} />
          <EyesGradientText text={EYES_LOGO[2]} />
          <Box marginTop={1}>
            <Text color="#a78bfa" bold>
              Eyes Pane
            </Text>
          </Box>
          <Text color={theme.textDim} wrap="truncate">
            {displayPath}
          </Text>
          <Text>
            <Text color="#4ade80">{verifiedCount} verified</Text>
            {failedCount > 0 && (
              <>
                <Text color={theme.textDim}> · </Text>
                <Text color="#ef4444">{failedCount} failed</Text>
              </>
            )}
            <Text color={theme.textDim}> · </Text>
            <Text color="#a78bfa">{signals.length} open signals</Text>
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1} marginBottom={1} width={columns}>
          <Box>
            <EyesGradientText text={EYES_LOGO[0]} />
            <Text>{GAP}</Text>
            <Text color="#a78bfa" bold>
              Eyes Pane
            </Text>
          </Box>
          <Box>
            <EyesGradientText text={EYES_LOGO[1]} />
            <Text>{GAP}</Text>
            <Text color={theme.textDim} wrap="truncate">
              {displayPath}
            </Text>
          </Box>
          <Box>
            <EyesGradientText text={EYES_LOGO[2]} />
            <Text>{GAP}</Text>
            <Text>
              <Text color="#4ade80">{verifiedCount} verified</Text>
              {failedCount > 0 && (
                <>
                  <Text color={theme.textDim}> · </Text>
                  <Text color="#ef4444">{failedCount} failed</Text>
                </>
              )}
              <Text color={theme.textDim}> · </Text>
              <Text color="#a78bfa">{signals.length} open signals</Text>
            </Text>
          </Box>
        </Box>
      )}

      {rows.length === 0 && (
        <Box flexDirection="column">
          <Text color={theme.textDim}>
            {"  No probes installed yet. Press "}
            <Text color={theme.primary}>a</Text>
            {" to set up, or run "}
            <Text color={theme.primary}>/eyes</Text>
            {" in the prompt."}
          </Text>
        </Box>
      )}

      {/* Inline section header before the first probe row (if any visible) */}
      {visibleRows.length > 0 && visibleRows[0].kind === "probe" && (
        <Box marginTop={1}>
          <Text color={theme.textDim}>── Installed probes ──</Text>
        </Box>
      )}

      {visibleRows.map((row, vi) => {
        const realIdx = startIdx + vi;
        const selected = realIdx === selectedIndex;
        const prefix = selected ? "❯ " : "  ";

        // Insert the signals header just above the first signal row
        const headerBefore =
          vi === firstSignalVisibleIdx ? (
            <Box key={`hdr-${vi}`} marginTop={1}>
              <Text color={theme.textDim}>── Open signals ──</Text>
            </Box>
          ) : null;

        if (row.kind === "probe") {
          const p = row.probe;
          const glyph = probeStatusGlyph(p.status);
          const glyphColor =
            p.status === "verified" ? "#4ade80" : p.status === "failed" ? "#ef4444" : theme.textDim;
          const isExpanded = expandedKey === `p:${p.name}`;
          return (
            <React.Fragment key={`p:${p.name}`}>
              {headerBefore}
              <Box flexDirection="column">
                <Text color={selected ? theme.primary : theme.text} bold={selected}>
                  {prefix}
                  <Text color={glyphColor}>{glyph}</Text>{" "}
                  <Text color={selected ? theme.primary : "#e5e7eb"}>{p.name.padEnd(18)}</Text>
                  <Text color={theme.textDim}>{p.capability.padEnd(16)}</Text>
                  <Text color={theme.textDim}>{p.impl}</Text>
                </Text>
                {isExpanded && (
                  <Box marginLeft={4} flexDirection="column">
                    <Text color={theme.textDim}>script: {p.script}</Text>
                    <Text color={theme.textDim}>status: {p.status}</Text>
                    {p.error && <Text color="#ef4444">error: {p.error}</Text>}
                  </Box>
                )}
              </Box>
            </React.Fragment>
          );
        }

        // Signal row
        const e = row.entry;
        const glyph = signalGlyph(e.kind);
        const kindColor =
          e.kind === "blocked" ? "#ef4444" : e.kind === "wish" ? "#60a5fa" : "#fbbf24";
        const probeTag = e.probe ? `[${e.probe}] ` : "";
        const isExpanded = expandedKey === `s:${e.id}`;
        return (
          <React.Fragment key={`s:${e.id}`}>
            {headerBefore}
            <Box flexDirection="column">
              <Text color={selected ? theme.primary : theme.text} bold={selected}>
                {prefix}
                <Text color={kindColor}>{glyph}</Text>{" "}
                <Text color={kindColor}>{e.kind.padEnd(8)}</Text>
                <Text color={theme.textDim}>{probeTag}</Text>
                <Text color={selected ? theme.primary : "#e5e7eb"}>{e.reason}</Text>
                <Text color={theme.textDim}> · {relTime(e.ts)}</Text>
              </Text>
              {isExpanded && (
                <Box marginLeft={4} flexDirection="column">
                  <Text color={theme.textDim}>id: {e.id}</Text>
                  <Text color={theme.textDim}>logged: {e.ts}</Text>
                  {e.probe && <Text color={theme.textDim}>probe: {e.probe}</Text>}
                </Box>
              )}
            </Box>
          </React.Fragment>
        );
      })}

      {status && (
        <Box marginTop={1}>
          <Text color={theme.textDim}>{status}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.textDim}>
          <Text color={theme.primary}>↑↓</Text>
          {" move · "}
          <Text color={theme.primary}>Enter</Text>
          {" expand · "}
          <Text color={theme.primary}>i</Text>
          {" improve · "}
          <Text color={theme.primary}>a</Text>
          {" add · "}
          <Text color={theme.primary}>v</Text>
          {" verify · "}
          <Text color={theme.primary}>d</Text>
          {" defer · "}
          <Text color={theme.primary}>x</Text>
          {" dismiss · "}
          <Text color={theme.primary}>ESC</Text>
          {" close"}
        </Text>
      </Box>
    </Box>
  );
}
