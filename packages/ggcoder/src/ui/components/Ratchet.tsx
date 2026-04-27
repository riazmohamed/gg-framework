import React, { useRef, useState, useLayoutEffect } from "react";
import { Box, measureElement, type DOMElement } from "ink";

interface Props {
  /**
   * `"always"` — lock the live area's height to the max it has reached
   * (resets when the area becomes empty between turns). Use for the active
   * streaming surface to prevent re-parse flicker.
   *
   * `"offscreen"` — pass-through, no height locking. Reserved for the
   * claude-code-style "lock only when scrolled out of view" behaviour;
   * we don't yet have a terminal-viewport hook, so this mode currently
   * lets content flow naturally rather than permanently inflating the
   * live area for blocks the user can see.
   */
  lock?: "always" | "offscreen";
  children: React.ReactNode;
}

/**
 * Height-ratchet: once content grows to N rows the outer Box never
 * shrinks below N, preventing jarring visual jumps when streaming
 * content temporarily shortens (e.g. markdown re-parse flicker).
 *
 * Mirrors claude-code's Ratchet, minus the viewport-visibility check.
 */
export function Ratchet({ children, lock = "always" }: Props): React.ReactNode {
  const innerRef = useRef<DOMElement | null>(null);
  const maxHeight = useRef(0);
  const [minHeight, setMinHeight] = useState(0);

  useLayoutEffect(() => {
    if (lock !== "always") return;
    if (!innerRef.current) return;
    const { height } = measureElement(innerRef.current);
    const termRows = process.stdout.rows ?? 24;
    // Cap live area to 50% of terminal so scrollback stays roomy and
    // the user can comfortably read what's already been written.
    const maxAllowed = Math.floor(termRows * 0.5);
    if (height === 0) {
      // Reset when live area is empty (between turns)
      maxHeight.current = 0;
      setMinHeight(0);
    } else if (height > maxHeight.current) {
      maxHeight.current = Math.min(height, maxAllowed);
      setMinHeight(maxHeight.current);
    }
  }, [children, lock]);

  // Without a terminal-viewport hook, "offscreen" mode falls back to a
  // plain pass-through. This prevents tool-result blocks from each pinning
  // their own peak height into the live area for the rest of the turn.
  if (lock !== "always") {
    return <Box flexDirection="column">{children}</Box>;
  }

  return (
    <Box minHeight={minHeight}>
      <Box ref={innerRef} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}
