import { describe, expect, it } from "vitest";
import { LocalEndpointError } from "../core/local-endpoint-store.js";
import { formatLocalState, parseLocalAddArgs } from "./local.js";

describe("ogcoder local", () => {
  it("parses add arguments in any order", () => {
    expect(parseLocalAddArgs(["http://box:8080/v1", "--label", "Box", "--api-key", "k"])).toEqual({
      baseUrl: "http://box:8080/v1",
      label: "Box",
      apiKey: "k",
    });
    expect(parseLocalAddArgs(["--label", "Box", "http://box:8080"])).toEqual({
      baseUrl: "http://box:8080",
      label: "Box",
    });
  });

  it("rejects a missing url, a flag without a value and unknown flags", () => {
    expect(() => parseLocalAddArgs([])).toThrow(LocalEndpointError);
    expect(() => parseLocalAddArgs(["http://x", "--label"])).toThrow("--label needs a value.");
    expect(() => parseLocalAddArgs(["http://x", "--key", "k"])).toThrow("Unknown option --key.");
    expect(() => parseLocalAddArgs(["http://x", "http://y"])).toThrow(
      'Unexpected argument "http://y".',
    );
  });

  it("lists running servers with their models and stopped ones with the reason", () => {
    const lines = formatLocalState({
      endpoints: [
        {
          id: "ollama",
          label: "Ollama",
          baseUrl: "http://localhost:11434/v1",
          kind: "ollama",
          custom: false,
          reachable: true,
          models: [
            {
              id: "local/ollama/qwen3:8b",
              rawId: "qwen3:8b",
              contextWindow: 40_960,
              contextWindowKnown: true,
              supportsTools: true,
              supportsImages: false,
              supportsThinking: true,
            },
            {
              id: "local/ollama/tiny",
              rawId: "tiny",
              contextWindow: 4096,
              contextWindowKnown: false,
              supportsTools: false,
              supportsImages: false,
              supportsThinking: false,
            },
          ],
        },
        {
          id: "box",
          label: "Box",
          baseUrl: "http://box:8080/v1",
          kind: "custom",
          custom: true,
          reachable: false,
          reason: "connection refused",
          models: [],
        },
      ],
    });
    expect(lines).toEqual([
      "● Ollama [ollama] http://localhost:11434/v1 — 2 models",
      "    local/ollama/qwen3:8b  41K · tools · thinking",
      "    local/ollama/tiny  4K assumed · no tools",
      "○ Box [box, added] http://box:8080/v1 — not running (connection refused)",
    ]);
  });
});
