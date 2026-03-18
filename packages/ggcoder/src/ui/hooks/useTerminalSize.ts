import React, { useState, useEffect, useRef, useCallback, useContext, createContext } from "react";
import { useStdout } from "ink";

interface TerminalSizeValue {
  columns: number;
  rows: number;
  resizeKey: number;
}

const TerminalSizeContext = createContext<TerminalSizeValue | null>(null);

/**
 * Provider that attaches a single resize listener to stdout and shares
 * { columns, rows, resizeKey } with all descendants via context.
 *
 * Mount this once near the root of the component tree (e.g. in render.ts
 * or App.tsx) to avoid the MaxListenersExceededWarning that occurs when
 * every component independently listens for resize events.
 */
export function TerminalSizeProvider({ children }: { children: React.ReactNode }) {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    columns: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
  });
  const [resizeKey, setResizeKey] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onResize = useCallback(() => {
    if (!stdout) return;

    // Update dimensions immediately for responsive layout
    setSize({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });

    // Debounce the resizeKey bump — only fires after the user stops dragging
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // Clear visible screen + scrollback to remove deformed ghost renders
      // left behind by Ink re-rendering at different terminal widths during
      // a resize drag.
      stdout.write(
        "\x1b[2J" + // clear visible screen
          "\x1b[3J" + // clear scrollback buffer
          "\x1b[H", // cursor home
      );
      setResizeKey((k) => k + 1);
    }, 300);
  }, [stdout]);

  useEffect(() => {
    if (!stdout) return;
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [stdout, onResize]);

  const value = React.useMemo(() => ({ ...size, resizeKey }), [size, resizeKey]);

  return React.createElement(TerminalSizeContext.Provider, { value }, children);
}

/**
 * Returns { columns, rows, resizeKey } from the nearest TerminalSizeProvider.
 *
 * `columns` and `rows` update immediately on every resize event so layout
 * stays responsive while the user drags.
 *
 * `resizeKey` increments once after resize events settle (300ms debounce).
 * Use it as a React `key` on the root content wrapper to force a full
 * remount — this is the only reliable way to make Ink re-render <Static>
 * content that was already printed to scrollback and got corrupted by
 * terminal text reflow.
 */
export function useTerminalSize() {
  const ctx = useContext(TerminalSizeContext);
  if (!ctx) {
    throw new Error("useTerminalSize must be used within a <TerminalSizeProvider>");
  }
  return ctx;
}
