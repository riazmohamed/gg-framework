import { describe, expect, it } from "vitest";
import { buildToolGroupSummary, segmentsToPlainText } from "./tool-group-summary.js";

describe("buildToolGroupSummary", () => {
  it("adds capped file details to grouped reads", () => {
    const text = segmentsToPlainText(
      buildToolGroupSummary(
        [
          {
            name: "read",
            args: { file_path: "packages/ggcoder/src/ui/App.tsx" },
            status: "done",
          },
          {
            name: "read",
            args: { file_path: "packages/ggcoder/src/ui/terminal-history.ts" },
            status: "done",
          },
          {
            name: "read",
            args: { file_path: "packages/ggcoder/src/ui/tool-group-summary.ts" },
            status: "done",
          },
        ],
        true,
      ),
    );

    expect(text).toBe("Read 3 files: App.tsx, terminal-history.ts, +1");
  });

  it("adds capped query details to grouped Search Code calls", () => {
    const text = segmentsToPlainText(
      buildToolGroupSummary(
        [
          {
            name: "mcp__kencode-search__searchCode",
            args: { query: "serializeCompletedItemToTerminalHistory" },
            status: "done",
          },
          {
            name: "mcp__kencode-search__searchCode",
            args: { query: "TerminalHistoryPrinter" },
            status: "done",
          },
          {
            name: "mcp__kencode-search__searchCode",
            args: { query: "currentItem?.type === reasoning" },
            status: "done",
          },
        ],
        true,
      ),
    );

    expect(text).toBe('Searched code with 3 queries: "serialize…History", "Terminal…Printer", +1');
  });

  it("adds capped details to grouped kencode reference and repo discovery calls", () => {
    expect(
      segmentsToPlainText(
        buildToolGroupSummary(
          [
            {
              name: "mcp__kencode-search__referenceSources",
              args: { query: "modern terminal UI inspiration", domain: "ui" },
              status: "done",
            },
            {
              name: "mcp__kencode-search__referenceSources",
              args: { query: "agent tool display patterns", domain: "agents" },
              status: "done",
            },
          ],
          true,
        ),
      ),
    ).toBe('Found references with 2 queries: "modern…inspiration", "agent…patterns"');

    expect(
      segmentsToPlainText(
        buildToolGroupSummary(
          [
            {
              name: "mcp__kencode-search__discoverRepos",
              args: { query: "ink react terminal components" },
              status: "done",
            },
            {
              name: "mcp__kencode-search__discoverRepos",
              args: { query: "agent cli tui" },
              status: "done",
            },
          ],
          true,
        ),
      ),
    ).toBe('Discovered repos with 2 queries: "ink…components", "agent cli tui"');
  });

  it("deduplicates grouped details before applying the cap", () => {
    const text = segmentsToPlainText(
      buildToolGroupSummary(
        [
          { name: "grep", args: { pattern: "tool_start" }, status: "done" },
          { name: "grep", args: { pattern: "tool_start" }, status: "done" },
          { name: "grep", args: { pattern: "server_tool_start" }, status: "done" },
        ],
        true,
      ),
    );

    expect(text).toBe('Searched for 3 patterns: "tool_start", "server_tool_start"');
  });
});
