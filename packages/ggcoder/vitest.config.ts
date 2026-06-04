import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
    // WSL on /mnt/c has slow disk I/O — the 5s default flakes on tests that
    // touch the filesystem (web-fetch, agent-session compaction).
    testTimeout: 30_000,
  },
});
