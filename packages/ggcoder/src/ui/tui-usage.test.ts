import { describe, expect, it, vi } from "vitest";
import type { UsageResult } from "../app-sidecar/usage.js";
import { createUsageCommand, formatUsage, resetLabel } from "./tui-usage.js";

const now = Date.UTC(2026, 9, 9, 12, 0, 0);
const claude: UsageResult = {
  provider: "anthropic",
  displayName: "Anthropic",
  connected: true,
  fetchedAt: now,
  windows: [
    { kind: "current", label: "5-hour", usedPercent: 42.4, resetsAt: now + 125 * 60_000 },
    { kind: "weekly", label: "Weekly", usedPercent: 90 },
  ],
};
const codexOff: UsageResult = {
  provider: "openai",
  displayName: "Codex",
  connected: false,
  windows: [],
  fetchedAt: now,
};

describe("/usage", () => {
  it("labels reset times like the desktop meter", () => {
    expect(resetLabel(undefined, now)).toBe("reset time unavailable");
    expect(resetLabel(now - 1, now)).toBe("resetting now");
    expect(resetLabel(now + 30 * 60_000, now)).toBe("resets in 30m");
    expect(resetLabel(now + 125 * 60_000, now)).toBe("resets in 2h 5m");
    expect(resetLabel(now + 50 * 3600_000, now)).toBe("resets in 2d 2h");
  });

  it("prints a bar per window and skips providers that are not logged in", () => {
    const text = formatUsage([claude, codexOff], now);
    expect(text).toContain("Anthropic");
    expect(text).toMatch(/5-hour\s+████░░░░░░\s+42%\s+resets in 2h 5m/);
    expect(text).toMatch(/Weekly\s+█████████░\s+90%\s+reset time unavailable/);
    expect(text).not.toContain("Codex");
    expect(formatUsage([codexOff], now, true)).toBe("Codex: not logged in with a subscription.");
    expect(formatUsage([codexOff], now)).toContain("No subscription logins");
  });

  it("marks replayed snapshots and surfaces fetch errors", () => {
    expect(formatUsage([{ ...claude, stale: true }], now)).toContain("Anthropic (last known)");
    const failing: UsageResult = {
      ...codexOff,
      connected: true,
      error: "Usage is temporarily unavailable.",
    };
    expect(formatUsage([failing], now)).toContain("Usage is temporarily unavailable.");
  });

  it("queries every provider, or just the one named", async () => {
    const fetch = vi.fn(async (provider: string) => (provider === "anthropic" ? claude : codexOff));
    const command = createUsageCommand(() => fetch as never);
    await command.execute("", {} as never);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(["anthropic", "openai", "moonshot"]);
    expect(await command.execute("gemini", {} as never)).toContain("Usage: /usage");
    expect(await createUsageCommand(() => null).execute("", {} as never)).toContain(
      "needs a logged-in session",
    );
  });
});
