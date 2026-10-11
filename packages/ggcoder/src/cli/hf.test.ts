import { describe, expect, it } from "vitest";
import { formatPullProgress, formatSearchRows, type HfPullEvent } from "./hf.js";

describe("ogcoder hf", () => {
  it("aligns search rows and shortens big counts", () => {
    expect(
      formatSearchRows([
        { id: "unsloth/Qwen3-8B-GGUF", downloads: 1_250_000, likes: 412, updatedAt: null },
        { id: "a/b", downloads: 12_345, likes: 3, updatedAt: null },
      ]),
    ).toEqual([
      "unsloth/Qwen3-8B-GGUF  1.3M downloads · 412 likes",
      "a/b                    12K downloads · 3 likes",
    ]);
  });

  it("shows download progress with ollama's detail, and plain phase labels otherwise", () => {
    const event: HfPullEvent = {
      repo: "a/b",
      model: "hf.co/a/b:Q4_K_M",
      file: "b-Q4_K_M.gguf",
      sizeBytes: 1,
      phase: "downloading",
      percent: 42.4,
      detail: "1 GB / 2 GB · 10 MB/s",
    };
    expect(formatPullProgress(event)).toBe("Downloading b-Q4_K_M.gguf 42% · 1 GB / 2 GB · 10 MB/s");
    expect(formatPullProgress({ ...event, phase: "preparing" })).toBe("Contacting Ollama…");
    expect(formatPullProgress({ ...event, phase: "verifying" })).toBe("Verifying…");
  });
});
