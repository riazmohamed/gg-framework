import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toAnthropicTools } from "./transform.js";
import type { Tool } from "../types.js";

const exampleTools: Tool[] = [
  {
    name: "read_file",
    description: "Read a file.",
    parameters: z.object({ filePath: z.string() }),
  },
  {
    name: "write_file",
    description: "Write a file.",
    parameters: z.object({ filePath: z.string(), content: z.string() }),
  },
];

describe("Anthropic transform", () => {
  it("adds cache_control only to the last tool definition", () => {
    const tools = toAnthropicTools(exampleTools, {
      cacheControl: { type: "ephemeral" },
    }) as unknown as Array<Record<string, unknown>>;

    expect(tools).toHaveLength(2);
    expect(tools[0]?.cache_control).toBeUndefined();
    expect(tools[1]?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("adds eager_input_streaming when fine-grained tool streaming is enabled", () => {
    const tools = toAnthropicTools(exampleTools, {
      cacheControl: { type: "ephemeral" },
      enableFineGrainedToolStreaming: true,
    }) as unknown as Array<Record<string, unknown>>;

    expect(tools.map((tool) => tool.eager_input_streaming)).toEqual([true, true]);
  });
});
