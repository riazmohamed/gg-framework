import chalk from "chalk";
import { marked, type Token, type Tokens } from "marked";
import wrapAnsi from "wrap-ansi";
import type { Theme } from "../theme/theme.js";
import { highlightCode } from "./highlight.js";
import { fitToWidth, centerToWidth, plainTextLength, wrapPlainTextLines } from "./table-text.js";
import { createHyperlink } from "./hyperlink.js";
import { supportsHyperlinks } from "./supports-hyperlinks.js";

// ── Marked configuration ──────────────────────────────────
// Disable del (strikethrough) tokenizer — `~` is commonly used for
// "approximate" in LLM output and causes false strikethrough parsing.
let markedConfigured = false;
function configureMarked(): void {
  if (markedConfigured) return;
  markedConfigured = true;
  marked.use({
    extensions: [
      {
        name: "del",
        level: "inline",
        start: () => -1, // never matches
        tokenizer: () => undefined,
      },
    ],
  });
}

// ── Helpers ───────────────────────────────────────────────

/** Prepend a prefix to every line in a string. */
function prefixLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

/** Convert number to lowercase letter (1→a, 2→b, ..., 27→aa). */
function numberToLetter(n: number): string {
  let result = "";
  while (n > 0) {
    n--;
    result = String.fromCharCode(97 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

/** Convert number to lowercase roman numeral. */
function numberToRoman(n: number): string {
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syms = ["m", "cm", "d", "cd", "c", "xc", "l", "xl", "x", "ix", "v", "iv", "i"];
  let result = "";
  for (let i = 0; i < vals.length; i++) {
    while (n >= vals[i]) {
      result += syms[i];
      n -= vals[i];
    }
  }
  return result;
}

/** Get formatted list number by depth (numeric → alpha → roman → numeric). */
function getListNumber(depth: number, n: number): string {
  switch (depth) {
    case 0:
    case 1:
      return n.toString();
    case 2:
      return numberToLetter(n);
    case 3:
      return numberToRoman(n);
    default:
      return n.toString();
  }
}

/** Replace owner/repo#123 with clickable GitHub links (OSC 8 when supported). */
const ISSUE_REF_PATTERN = /(^|[^\w./-])([A-Za-z0-9][\w-]*\/[A-Za-z0-9][\w.-]*)#(\d+)\b/g;

function linkifyIssueReferences(text: string): string {
  if (!supportsHyperlinks()) return text;
  return text.replace(ISSUE_REF_PATTERN, (_match, prefix: string, repo: string, num: string) => {
    return `${prefix}${createHyperlink(`https://github.com/${repo}/issues/${num}`, `${repo}#${num}`)}`;
  });
}

// ── Main API ──────────────────────────────────────────────

/**
 * Convert an array of marked block-level tokens into a single ANSI string.
 * Each block is separated by a blank line. The result can be passed directly
 * to Ink's `<Text>`.
 */
export function tokensToAnsi(tokens: Token[], theme: Theme, columns: number): string {
  configureMarked();
  return tokens
    .map((t, i) => tokenToAnsi(t, theme, 0, undefined, undefined, columns, i > 0))
    .join("")
    .trim();
}

function tokenToAnsi(
  token: Token,
  theme: Theme,
  depth: number,
  orderedIndex: number | undefined,
  parent: Token | undefined,
  columns: number,
  addGap: boolean,
): string {
  const gap = addGap ? "\n" : "";

  switch (token.type) {
    case "heading": {
      const heading = token as Tokens.Heading;
      const inline = inlineToAnsi(heading.tokens ?? [], theme);
      switch (heading.depth) {
        case 1:
          return gap + chalk.bold.italic.underline(inline) + "\n\n";
        default:
          return gap + chalk.bold(inline) + "\n\n";
      }
    }

    case "paragraph":
      return gap + inlineToAnsi((token as Tokens.Paragraph).tokens ?? [], theme) + "\n";

    case "list": {
      const list = token as Tokens.List;
      const items = list.items.map((item, idx) => {
        const startNum = Number(list.start ?? 1) + idx;
        const bullet = list.ordered ? `${getListNumber(depth, startNum)}. ` : "- ";
        const indent = "  ".repeat(depth);

        const content = item.tokens
          .map((t) => {
            if (t.type === "text" && "tokens" in t && (t as Tokens.Text).tokens) {
              return inlineToAnsi((t as Tokens.Text).tokens!, theme);
            }
            if (t.type === "list") {
              return "\n" + tokenToAnsi(t, theme, depth + 1, undefined, token, columns, false);
            }
            if (t.type === "text") {
              return linkifyIssueReferences(t.raw);
            }
            return tokenToAnsi(t, theme, depth + 1, undefined, token, columns, false);
          })
          .join("");

        return indent + bullet + content;
      });
      return gap + items.join("\n");
    }

    case "code": {
      const code = token as Tokens.Code;
      const lang = code.lang ?? "";
      const raw = code.text;
      const gutter = chalk.hex(theme.border)("\u258E ");

      if (!lang) {
        return gap + prefixLines(raw, gutter);
      }

      const header = chalk.dim.italic(lang);
      const highlighted = highlightCode(raw, lang);
      return gap + gutter + header + "\n" + prefixLines(highlighted, gutter);
    }

    case "blockquote": {
      const bq = token as Tokens.Blockquote;
      // Pre-wrap paragraph content to fit `columns - 2` (accounting for the
      // "\u2502 " gutter). Without this, long one-line blockquotes (e.g. the
      // restart notice emitted by /eyes) get truncated by Ink's Text wrap
      // when nested ANSI codes confuse its width calculation.
      const barWidth = 2;
      const wrapWidth = Math.max(20, columns - barWidth);
      const inner = (bq.tokens ?? [])
        .map((t) => {
          if (t.type === "paragraph") {
            const para = chalk.italic.hex(theme.textMuted)(
              inlineToAnsi((t as Tokens.Paragraph).tokens ?? [], theme, theme.textMuted),
            );
            return wrapAnsi(para, wrapWidth, { hard: true, wordWrap: true });
          }
          return tokenToAnsi(t, theme, depth, undefined, token, columns, false);
        })
        .join("\n");
      const bar = chalk.hex(theme.accent)("\u2502 ");
      return gap + prefixLines(inner, bar);
    }

    case "table": {
      const table = token as Tokens.Table;
      const numCols = table.header.length;

      // Calculate natural column widths
      const naturalWidths = table.header.map((cell, ci) => {
        const headerLen = plainTextLength(cell.tokens);
        const rowMax = table.rows.reduce(
          (max, row) => Math.max(max, plainTextLength(row[ci]?.tokens ?? [])),
          0,
        );
        return Math.max(headerLen, rowMax, 3);
      });

      // Cap to fit terminal
      const overhead = numCols * 3 + 1; // "| " per col + trailing " |"
      const availableForContent = columns - overhead;
      const totalNatural = naturalWidths.reduce((a, b) => a + b, 0);

      let colWidths: number[];
      if (totalNatural <= availableForContent) {
        colWidths = naturalWidths;
      } else {
        colWidths = [...naturalWidths];
        let remaining = availableForContent;
        const locked = new Set<number>();
        while (locked.size < numCols) {
          const unlocked = colWidths.filter((_, i) => !locked.has(i));
          const fair = Math.floor(remaining / unlocked.length);
          let changed = false;
          for (let i = 0; i < colWidths.length; i++) {
            if (locked.has(i)) continue;
            if (colWidths[i] <= fair) {
              locked.add(i);
              remaining -= colWidths[i];
              changed = true;
            }
          }
          if (!changed) {
            const unlockedIdxs = colWidths.map((_, i) => i).filter((i) => !locked.has(i));
            const each = Math.floor(remaining / unlockedIdxs.length);
            let leftover = remaining - each * unlockedIdxs.length;
            for (const i of unlockedIdxs) {
              colWidths[i] = each + (leftover > 0 ? 1 : 0);
              if (leftover > 0) leftover--;
            }
            break;
          }
        }
      }

      // Box-drawing table with multi-line cell wrapping
      const hLine = (left: string, mid: string, right: string) =>
        left + colWidths.map((w) => "\u2501".repeat(w + 2)).join(mid) + right;

      // Pre-wrap cells into lines of exactly colWidths[ci] chars
      const wrapCell = (tokens: Token[], ci: number) =>
        wrapPlainTextLines(tokens, colWidths[ci]).map((l) => fitToWidth(l, colWidths[ci]));
      const wrapCellCenter = (tokens: Token[], ci: number) =>
        wrapPlainTextLines(tokens, colWidths[ci]).map((l) => centerToWidth(l, colWidths[ci]));

      const headerWrapped = table.header.map((cell, ci) => wrapCellCenter(cell.tokens, ci));
      const headerLineCount = Math.max(1, ...headerWrapped.map((lines) => lines.length));

      const bodyWrapped = table.rows.map((row) => row.map((cell, ci) => wrapCell(cell.tokens, ci)));
      const bodyLineCounts = bodyWrapped.map((row) =>
        Math.max(1, ...row.map((lines) => lines.length)),
      );

      const buildRowLine = (wrappedCells: string[][], lineIdx: number) => {
        let row = "";
        for (let ci = 0; ci < wrappedCells.length; ci++) {
          const cell = wrappedCells[ci][lineIdx] ?? fitToWidth("", colWidths[ci]);
          row += "\u2503 " + cell + " ";
        }
        row += "\u2503";
        return row;
      };

      const lines: string[] = [];
      // Top border
      lines.push(hLine("\u250F", "\u2533", "\u2513"));
      // Header lines
      for (let li = 0; li < headerLineCount; li++) {
        lines.push(chalk.bold(buildRowLine(headerWrapped, li)));
      }
      // Header/body separator
      lines.push(hLine("\u2523", "\u254B", "\u252B"));
      // Body rows
      for (let ri = 0; ri < bodyWrapped.length; ri++) {
        for (let li = 0; li < bodyLineCounts[ri]; li++) {
          lines.push(buildRowLine(bodyWrapped[ri], li));
        }
        // Row separator (between rows, not after last)
        if (ri < bodyWrapped.length - 1) {
          lines.push(hLine("\u2523", "\u254B", "\u252B"));
        }
      }
      // Bottom border
      lines.push(hLine("\u2517", "\u253B", "\u251B"));

      return gap + lines.join("\n");
    }

    case "hr":
      return gap + "---";

    case "space":
      return "\n";

    case "html":
    case "def":
      return "";

    default:
      if ("raw" in token && typeof token.raw === "string") {
        return gap + token.raw;
      }
      return "";
  }
}

function inlineToAnsi(tokens: Token[], theme: Theme, _parentColor?: string): string {
  return tokens
    .map((token) => {
      switch (token.type) {
        case "strong":
          return chalk.bold(inlineToAnsi((token as Tokens.Strong).tokens ?? [], theme));

        case "em":
          return chalk.italic(inlineToAnsi((token as Tokens.Em).tokens ?? [], theme));

        case "codespan":
          return chalk.hex(theme.code)((token as Tokens.Codespan).text);

        case "del":
          return chalk.strikethrough.hex(theme.textDim)((token as Tokens.Del).text);

        case "link": {
          const link = token as Tokens.Link;
          if (link.href.startsWith("mailto:")) {
            return link.href.replace(/^mailto:/, "");
          }
          // Use OSC 8 clickable hyperlinks when supported
          const linkText = link.text || link.href;
          if (linkText !== link.href) {
            return createHyperlink(link.href, linkText);
          }
          return createHyperlink(link.href);
        }

        case "image":
          return (token as Tokens.Image).href;

        case "text": {
          const textToken = token as Tokens.Text;
          if ("tokens" in textToken && textToken.tokens) {
            return inlineToAnsi(textToken.tokens, theme);
          }
          return linkifyIssueReferences(textToken.raw);
        }

        case "escape":
          return (token as Tokens.Escape).text;

        case "br":
          return "\n";

        default:
          if ("raw" in token && typeof token.raw === "string") {
            return token.raw;
          }
          return "";
      }
    })
    .join("");
}
