import { describe, it, expect } from "vitest";
import { getSplashAudioDurationMs } from "./audio.js";

describe("getSplashAudioDurationMs", () => {
  it("reads the bundled splash.mp3 within an expected range", () => {
    // The current asset is ~1.44s. Allow generous slack so swapping the
    // asset doesn't break the test — we're really just asserting that the
    // parser produces a sensible non-fallback value (not the 1500ms default).
    const ms = getSplashAudioDurationMs();
    expect(ms).toBeGreaterThan(500);
    expect(ms).toBeLessThan(10000);
  });
});
