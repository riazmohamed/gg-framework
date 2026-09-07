import { vi } from "vitest";

// The TUI status dot is platform-conditional (⏺ on macOS, ● elsewhere — see
// src/ui/constants/figures.ts), but the upstream test fixtures hard-code the
// macOS glyph. Pin the mac glyph under test so the suite is deterministic on
// Linux/WSL/Windows instead of failing on every non-mac machine.
vi.mock("./src/ui/constants/figures.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./src/ui/constants/figures.js")>();
  return {
    ...actual,
    BLACK_CIRCLE: "⏺",
  };
});
