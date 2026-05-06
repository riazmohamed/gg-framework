import React, { useRef, useState, useLayoutEffect, useMemo } from "react";
import { Text, Box, useStdout, measureElement, type DOMElement } from "ink";
import { marked, type Token, type Tokens } from "marked";
import { useTheme } from "../theme/theme.js";
import { tokensToAnsi } from "../utils/token-to-ansi.js";
import { markdownAnsiCache, containsMarkdownSyntax } from "../utils/markdown-cache.js";

/**
 * Render a markdown string as a single ANSI-formatted `<Text>` element.
 *
 * Pass an explicit `width` to bypass self-measurement — strongly
 * recommended during streaming to avoid 30+ measureElement calls/sec.
 * Required inside Ink's `<Static>` where re-renders don't update
 * flushed output.
 */
export const Markdown = React.memo(function Markdown({
  children,
  width: explicitWidth,
}: {
  children: string;
  width?: number;
}) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const ref = useRef<DOMElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(0);

  // Only self-measure when no explicit width is provided. When explicitWidth
  // is set (e.g. during streaming), this effect is a no-op — avoiding
  // ~30 measureElement calls/sec that cause layout thrashing.
  useLayoutEffect(() => {
    if (explicitWidth != null) return;
    if (ref.current) {
      const { width } = measureElement(ref.current);
      if (width > 0 && width !== measuredWidth) {
        setMeasuredWidth(width);
      }
    }
    // Depend on measuredWidth so we re-measure if it changes (e.g. resize),
    // but NOT on children — that's what caused 30/sec measurements.
  }, [measuredWidth, explicitWidth]);

  const columns =
    explicitWidth != null
      ? explicitWidth
      : measuredWidth > 0
        ? measuredWidth
        : Math.max(40, (stdout?.columns || 80) - 4);

  // Stabilise table rendering during streaming: if the text ends with an
  // incomplete table row (starts with `|` but doesn't end with `|`), strip
  // that trailing fragment before parsing.  This prevents marked from
  // flip-flopping between "text" and "table" tokens as each character
  // arrives, which is the primary cause of table flicker.
  const stabilised = useMemo(() => {
    const lines = children.split("\n");
    let trailingFragment = "";
    // Walk backwards to find an incomplete trailing table row
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      if (lastLine.startsWith("|") && !lastLine.trimEnd().endsWith("|")) {
        trailingFragment = lines.pop()!;
      }
    }

    // Detect unclosed code fences: if there's an opening ``` without a matching
    // close, strip just the opening fence line so marked doesn't swallow all
    // subsequent content (lists, bullets, etc.) into one giant code block.
    // The content after the fence is kept in the body as regular markdown.
    let body = lines.join("\n");
    const fencePattern = /^(`{3,}|~{3,})([^\n]*)/m;
    let searchFrom = 0;
    while (searchFrom < body.length) {
      const openMatch = fencePattern.exec(body.slice(searchFrom));
      if (!openMatch) break;
      const openIdx = searchFrom + openMatch.index;
      const fence = openMatch[1];
      const afterOpen = body.indexOf("\n", openIdx);
      if (afterOpen === -1) break; // fence is the last line
      // Find the closing fence (same char, same or more length, at start of line)
      const closePattern = new RegExp(`^${fence[0]}{${fence.length},}\\s*$`, "m");
      const closeMatch = closePattern.exec(body.slice(afterOpen));
      if (closeMatch) {
        // Fence is closed — skip past it
        searchFrom = afterOpen + closeMatch.index + closeMatch[0].length;
      } else {
        // Unclosed fence — remove the opening fence line so the content
        // after it gets parsed as normal markdown (lists, bullets, etc.)
        body = body.slice(0, openIdx) + body.slice(afterOpen + 1);
        break;
      }
    }

    // Strip trailing incomplete inline link syntax: a `[` without a matching
    // `]` at the end of the text causes marked to render it as literal text,
    // producing a brief `[` flicker before the full link arrives.
    const lastOpen = body.lastIndexOf("[");
    if (lastOpen !== -1 && body.indexOf("]", lastOpen) === -1) {
      body = body.slice(0, lastOpen);
    }

    return { body, trailingFragment };
  }, [children]);

  // Layered caching:
  // 1. Plain-text fast path — skip marked.lexer() entirely for text with no markdown syntax
  // 2. LRU cache (500 entries, keyed by body+theme+width) — avoids re-parsing
  //    completed messages on scroll and unchanged streaming bodies
  //
  // The 16ms flush in useAgentLoop already caps re-renders at ~60Hz; an
  // additional char-delta throttle would lag the visible output.
  const ansiOutput = useMemo(() => {
    const body = stabilised.body;
    const cached = markdownAnsiCache.get(body, theme.name, columns);
    if (cached) return cached;

    // Plain-text fast path: skip marked.lexer() for text with no markdown syntax
    let tokens: Token[];
    if (!containsMarkdownSyntax(body)) {
      tokens = [
        {
          type: "paragraph",
          raw: body,
          text: body,
          tokens: [{ type: "text", raw: body, text: body }],
        } as Tokens.Paragraph,
      ];
    } else {
      tokens = marked.lexer(body);
    }

    const result = tokensToAnsi(tokens, theme, columns);
    markdownAnsiCache.set(body, theme.name, columns, result);
    return result;
  }, [stabilised.body, theme, columns]);

  return (
    <Box ref={ref} flexDirection="column" flexShrink={1}>
      <Text>{ansiOutput}</Text>
      {stabilised.trailingFragment && <Text>{stabilised.trailingFragment}</Text>}
    </Box>
  );
});

// ── Streaming Markdown ────────────────────────────────────────
//
// Splits text at the last top-level block boundary.  Everything before
// the boundary is "stable" — memoized, never re-parsed.  Only the
// final (unstable) block is re-parsed on each streaming delta, making
// the cost O(unstable tail) instead of O(full text).

/**
 * Strip trailing incomplete table rows and unclosed code fences,
 * identical to the stabilisation logic in <Markdown>.
 */
function stabilize(text: string): string {
  const lines = text.split("\n");
  if (lines.length > 0) {
    const lastLine = lines[lines.length - 1];
    if (lastLine.startsWith("|") && !lastLine.trimEnd().endsWith("|")) {
      lines.pop();
    }
  }
  let body = lines.join("\n");
  const fencePattern = /^(`{3,}|~{3,})([^\n]*)/m;
  let searchFrom = 0;
  while (searchFrom < body.length) {
    const openMatch = fencePattern.exec(body.slice(searchFrom));
    if (!openMatch) break;
    const openIdx = searchFrom + openMatch.index;
    const fence = openMatch[1];
    const afterOpen = body.indexOf("\n", openIdx);
    if (afterOpen === -1) break;
    const closePattern = new RegExp(`^${fence[0]}{${fence.length},}\\s*$`, "m");
    const closeMatch = closePattern.exec(body.slice(afterOpen));
    if (closeMatch) {
      searchFrom = afterOpen + closeMatch.index + closeMatch[0].length;
    } else {
      body = body.slice(0, openIdx) + body.slice(afterOpen + 1);
      break;
    }
  }
  return body;
}

export const StreamingMarkdown = React.memo(function StreamingMarkdown({
  children,
  width,
}: {
  children: string;
  width: number;
}) {
  const stableBoundaryRef = useRef(0);

  const stripped = useMemo(() => stabilize(children), [children]);

  // Find the last top-level block boundary and advance stableBoundaryRef monotonically
  const { stablePrefix, unstableSuffix } = useMemo(() => {
    const boundary = stableBoundaryRef.current;
    const tail = stripped.substring(boundary);

    // Skip full lexing if tail is short enough — not worth the split overhead
    if (tail.length < 200) {
      return { stablePrefix: stripped.substring(0, boundary), unstableSuffix: tail };
    }

    const tokens = containsMarkdownSyntax(tail) ? marked.lexer(tail) : [];

    // Find last non-space content token
    let lastContentIdx = tokens.length - 1;
    while (lastContentIdx >= 0 && tokens[lastContentIdx]?.type === "space") {
      lastContentIdx--;
    }

    // Sum raw lengths of all tokens except the last = stable advancement
    let advance = 0;
    for (let i = 0; i < lastContentIdx; i++) {
      advance += tokens[i]!.raw.length;
    }

    // Only advance forward (monotonic)
    if (advance > 0) {
      stableBoundaryRef.current = boundary + advance;
    }

    return {
      stablePrefix: stripped.substring(0, stableBoundaryRef.current),
      unstableSuffix: stripped.substring(stableBoundaryRef.current),
    };
  }, [stripped]);

  return (
    <Box flexDirection="column" gap={1}>
      {stablePrefix && <Markdown width={width}>{stablePrefix}</Markdown>}
      {unstableSuffix && <Markdown width={width}>{unstableSuffix}</Markdown>}
    </Box>
  );
});
