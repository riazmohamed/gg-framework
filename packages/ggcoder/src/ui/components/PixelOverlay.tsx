import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { DEFAULT_INGEST_URL } from "@kenkaiiii/gg-pixel";
import { fetchPixelEntries, type PixelEntry, type PixelFetchResult } from "../../core/pixel.js";
import { renderScreen } from "../pixel.js";

interface Props {
  onClose: () => void;
  onFixOne: (entry: PixelEntry) => void;
  onFixAll: (entries: PixelEntry[]) => void;
  agentRunning?: boolean;
  version?: string;
}

export function PixelOverlay({ onClose, onFixOne, onFixAll, agentRunning, version }: Props) {
  const { stdout } = useStdout();
  const [data, setData] = useState<PixelFetchResult>({
    entries: [],
    unreachable: [],
    unmanaged: [],
    hasProjects: false,
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [status, setStatus] = useState("");
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showStatus = (msg: string) => {
    setStatus(msg);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(""), 2500);
  };

  // Fetch on mount + every 2s so the pane reflects new errors / fix results.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void fetchPixelEntries().then((d) => {
        if (cancelled) return;
        setData((prev) => {
          // Avoid clobbering pending optimistic deletes
          const prevJson = JSON.stringify(prev);
          const nextJson = JSON.stringify(d);
          return prevJson === nextJson ? prev : d;
        });
      });
    };
    load();
    const t = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // Clamp the selected index when entries change.
  useEffect(() => {
    if (data.entries.length === 0) {
      setSelectedIndex(0);
    } else if (selectedIndex >= data.entries.length) {
      setSelectedIndex(data.entries.length - 1);
    }
  }, [data.entries.length, selectedIndex]);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(data.entries.length - 1, i + 1));
      return;
    }
    if (key.return) {
      if (data.entries.length === 0) return;
      if (agentRunning) {
        showStatus("Agent is busy — wait for it to finish");
        return;
      }
      const e = data.entries[selectedIndex];
      if (e) onFixOne(e);
      return;
    }
    if (input === "f" || input === "r") {
      if (data.entries.length === 0) return;
      if (agentRunning) {
        showStatus("Agent is busy — wait for it to finish");
        return;
      }
      onFixAll(data.entries);
      return;
    }
    if (input === "d" || (key.backspace ?? false) || (key.delete ?? false)) {
      if (data.entries.length === 0) return;
      const e = data.entries[selectedIndex];
      if (!e) return;
      // Optimistic local removal; fire-and-forget DELETE.
      setData((prev) => ({
        ...prev,
        entries: prev.entries.filter((x) => x.errorId !== e.errorId),
      }));
      void fetch(`${DEFAULT_INGEST_URL.replace(/\/+$/, "")}/api/errors/${e.errorId}`, {
        method: "DELETE",
      }).catch(() => {
        // Backend may be unreachable; the entry will reappear on next fetch.
      });
      return;
    }
  });

  // Clear screen each render so the frame stays anchored at the top.
  useEffect(() => {
    stdout?.write("\x1b[2J\x1b[3J\x1b[H");
  }, [stdout]);

  const screen = renderScreen(data, selectedIndex, { version });
  const lines = screen.split("\n");

  return (
    <Box flexDirection="column">
      {lines.map((l, i) => (
        <Text key={i}>{l === "" ? " " : l}</Text>
      ))}
      {status && <Text color="#fbbf24"> {status}</Text>}
    </Box>
  );
}
