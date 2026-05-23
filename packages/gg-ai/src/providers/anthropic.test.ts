import { describe, expect, it, vi } from "vitest";
import type { ProviderError } from "../errors.js";
import { streamAnthropic } from "./anthropic.js";

const streamMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status: number | undefined;
    error: unknown;
    requestID: string | null | undefined;
    type: string | null;

    constructor(
      status: number | undefined,
      error: unknown,
      message: string,
      requestID?: string | null,
      type?: string | null,
    ) {
      super(message);
      this.status = status;
      this.error = error;
      this.requestID = requestID;
      this.type = type ?? null;
    }
  }

  class AnthropicMock {
    static APIError = APIError;
    static nextError: Error | null = null;
    static nextEvents: unknown[] | null = null;
    messages = {
      stream: streamMock.mockImplementation(() => {
        const error = AnthropicMock.nextError;
        const events = AnthropicMock.nextEvents;
        if (!error && !events) {
          throw new Error("test did not configure AnthropicMock.nextError or nextEvents");
        }
        const iterator = (async function* () {
          if (events) {
            for (const event of events) yield event;
            return;
          }
          yield* [];
          throw error;
        })();
        return Object.assign(iterator, { currentMessage: null });
      }),
    };
  }

  return { default: AnthropicMock };
});

describe("streamAnthropic request shaping", () => {
  it("sends thinking, cache, image, and tool transform params", async () => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const AnthropicMock = Anthropic as unknown as {
      nextError: Error | null;
      nextEvents: unknown[] | null;
    };
    AnthropicMock.nextError = null;
    AnthropicMock.nextEvents = [{ type: "message_stop" }];

    const result = streamAnthropic({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      messages: [
        { role: "system", content: "stable\n<!-- uncached -->\nnow" },
        {
          role: "user",
          content: [
            { type: "text", text: "see" },
            { type: "image", mediaType: "image/png", data: "abc" },
          ],
        },
      ],
      apiKey: "sk-ant-test",
      thinking: "high",
      cacheRetention: "short",
      temperature: 0.7,
    });
    for await (const _event of result) {
      /* consume */
    }

    const params = streamMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(params).toMatchObject({ thinking: { type: "enabled" }, stream: true });
    expect(params.temperature).toBeUndefined();
    expect(params.system).toEqual([
      { type: "text", text: "stable", cache_control: { type: "ephemeral" } },
      { type: "text", text: "now" },
    ]);
    expect(params.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "see" },
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "abc" },
            cache_control: { type: "ephemeral" },
          },
        ],
      },
    ]);
  });
});

describe("streamAnthropic error normalization", () => {
  it("extracts streamed api_error details and request ID", async () => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const AnthropicMock = Anthropic as unknown as {
      APIError: new (
        status: number | undefined,
        error: unknown,
        message: string,
        requestID?: string | null,
        type?: string | null,
      ) => Error;
      nextError: Error | null;
      nextEvents: unknown[] | null;
    };
    AnthropicMock.nextEvents = null;
    AnthropicMock.nextError = new AnthropicMock.APIError(
      undefined,
      {
        type: "error",
        error: {
          details: null,
          type: "api_error",
          message: "Internal server error",
        },
        request_id: "req_011Cb6hYLp9bbMmkqdo2yTWL",
      },
      '{"type":"error","error":{"details":null,"type":"api_error","message":"Internal server error"},"request_id":"req_011Cb6hYLp9bbMmkqdo2yTWL"}',
      null,
      "api_error",
    );

    const result = streamAnthropic({
      provider: "anthropic",
      model: "claude-test",
      messages: [{ role: "user", content: "hi" }],
      apiKey: "sk-ant-test",
    });

    await expect(result.response).rejects.toMatchObject({
      provider: "anthropic",
      message: "api_error: Internal server error",
      requestId: "req_011Cb6hYLp9bbMmkqdo2yTWL",
    } satisfies Partial<ProviderError>);
  });

  it("preserves tool arguments carried on the streamed content block start", async () => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const AnthropicMock = Anthropic as unknown as {
      nextError: Error | null;
      nextEvents: unknown[] | null;
    };
    AnthropicMock.nextError = null;
    AnthropicMock.nextEvents = [
      {
        type: "message_start",
        message: { usage: { input_tokens: 7 } },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "toolu_123",
          name: "bash",
          input: { command: "echo ok" },
        },
      },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 3 } },
      { type: "message_stop" },
    ];

    const result = streamAnthropic({
      provider: "anthropic",
      model: "claude-test",
      messages: [{ role: "user", content: "hi" }],
      apiKey: "sk-ant-test",
    });

    const events = [];
    for await (const event of result) {
      events.push(event);
    }

    await expect(result.response).resolves.toMatchObject({
      message: {
        content: [
          {
            type: "tool_call",
            id: "toolu_123",
            name: "bash",
            args: { command: "echo ok" },
          },
        ],
      },
      stopReason: "tool_use",
    });
    expect(events).toContainEqual({
      type: "toolcall_done",
      id: "toolu_123",
      name: "bash",
      args: { command: "echo ok" },
    });
  });
});
