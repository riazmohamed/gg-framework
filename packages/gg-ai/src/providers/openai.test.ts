import { afterEach, describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import type { Provider } from "../types.js";
import { streamOpenAI } from "./openai.js";

const createMock = vi.fn();

vi.mock("openai", () => {
  class OpenAIMock {
    chat = {
      completions: {
        create: createMock,
      },
    };
  }
  return { default: OpenAIMock };
});

function createStreamingResult(argsJson: string): AsyncIterable<OpenAI.ChatCompletionChunk> {
  return (async function* () {
    yield {
      id: "chatcmpl_1",
      object: "chat.completion.chunk",
      created: 1,
      model: "test",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "bash", arguments: argsJson },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };
    yield {
      id: "chatcmpl_1",
      object: "chat.completion.chunk",
      created: 1,
      model: "test",
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
  })() as AsyncIterable<OpenAI.ChatCompletionChunk>;
}

async function collectResponse(provider: Provider, argsJson: string) {
  createMock.mockResolvedValueOnce(createStreamingResult(argsJson));
  const result = streamOpenAI({
    provider,
    model: "test-model",
    messages: [{ role: "user", content: "hi" }],
    apiKey: "token",
  });

  const events = [];
  for await (const event of result) events.push(event);
  return { events, response: await result.response };
}

describe("streamOpenAI request shaping", () => {
  afterEach(() => {
    createMock.mockReset();
  });

  it.each<[Provider, Record<string, unknown>]>([
    ["openai", { reasoning_effort: "high", prompt_cache_key: "ggcoder", thinking: undefined }],
    [
      "glm",
      { thinking: { type: "enabled" }, reasoning_effort: undefined, prompt_cache_key: undefined },
    ],
    [
      "moonshot",
      { thinking: { type: "enabled" }, reasoning_effort: undefined, prompt_cache_key: "ggcoder" },
    ],
    [
      "xiaomi",
      { thinking: { type: "enabled" }, reasoning_effort: undefined, prompt_cache_key: undefined },
    ],
  ])("sends provider-specific thinking params for %s", async (provider, expected) => {
    createMock.mockResolvedValueOnce(createStreamingResult(""));
    const result = streamOpenAI({
      provider,
      model: "test-model",
      messages: [{ role: "user", content: "hi" }],
      apiKey: "token",
      thinking: "high",
    });
    for await (const _event of result) {
      /* consume */
    }
    const params = createMock.mock.calls[0]?.[0] as Record<string, unknown>;
    for (const [key, value] of Object.entries(expected)) {
      expect(params[key]).toEqual(value);
    }
  });

  it("passes xhigh reasoning effort through for OpenAI GPT models", async () => {
    createMock.mockResolvedValueOnce(createStreamingResult(""));
    const result = streamOpenAI({
      provider: "openai",
      model: "gpt-5.5",
      messages: [{ role: "user", content: "hi" }],
      apiKey: "token",
      thinking: "xhigh",
    });
    for await (const _event of result) {
      /* consume */
    }
    expect(createMock.mock.calls[0]?.[0]).toMatchObject({ reasoning_effort: "xhigh" });
  });

  it("disables Xiaomi thinking explicitly when thinking is off", async () => {
    createMock.mockResolvedValueOnce(createStreamingResult(""));
    const result = streamOpenAI({
      provider: "xiaomi",
      model: "test-model",
      messages: [{ role: "user", content: "hi" }],
      apiKey: "token",
    });
    for await (const _event of result) {
      /* consume */
    }
    expect(createMock.mock.calls[0]?.[0]).toMatchObject({ thinking: { type: "disabled" } });
  });
});

describe("streamOpenAI tool argument parsing", () => {
  afterEach(() => {
    createMock.mockReset();
  });

  it.each<Provider>(["openai", "glm", "moonshot", "xiaomi", "deepseek", "openrouter"])(
    "preserves streamed function call arguments for %s",
    async (provider) => {
      const { events, response } = await collectResponse(provider, '{"command":"echo ok"}');

      expect(response).toMatchObject({
        message: {
          content: [
            {
              type: "tool_call",
              id: "call_1",
              name: "bash",
              args: { command: "echo ok" },
            },
          ],
        },
        stopReason: "tool_use",
      });
      expect(events).toContainEqual({
        type: "toolcall_done",
        id: "call_1",
        name: "bash",
        args: { command: "echo ok" },
      });
    },
  );

  it("unwraps double-encoded streamed function call arguments", async () => {
    const { response } = await collectResponse("glm", JSON.stringify('{"command":"echo ok"}'));

    expect(response.message.content).toMatchObject([
      {
        type: "tool_call",
        id: "call_1",
        name: "bash",
        args: { command: "echo ok" },
      },
    ]);
  });
});
