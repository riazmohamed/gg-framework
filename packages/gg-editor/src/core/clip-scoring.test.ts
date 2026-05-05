import { afterEach, describe, expect, it, vi } from "vitest";
import {
  combineClipScore,
  parseClipScoreResponse,
  scoreClipInternal,
} from "./clip-scoring.js";

describe("parseClipScoreResponse", () => {
  it("parses a well-formed response", () => {
    const r = parseClipScoreResponse(
      JSON.stringify({ hook: 0.8, flow: 0.7, engagement: 0.9, trend: 0.4, why: "strong open" }),
    );
    expect(r.hook).toBe(0.8);
    expect(r.flow).toBe(0.7);
    expect(r.engagement).toBe(0.9);
    expect(r.trend).toBe(0.4);
    expect(r.why).toContain("strong");
  });

  it("clamps out-of-range values to [0,1]", () => {
    const r = parseClipScoreResponse(
      JSON.stringify({ hook: 99, flow: -5, engagement: 0.5, trend: 1 }),
    );
    expect(r.hook).toBe(1);
    expect(r.flow).toBe(0);
    expect(r.engagement).toBe(0.5);
    expect(r.trend).toBe(1);
  });

  it("falls back to 0 on missing fields", () => {
    const r = parseClipScoreResponse("{}");
    expect(r.hook).toBe(0);
    expect(r.flow).toBe(0);
    expect(r.engagement).toBe(0);
    expect(r.trend).toBe(0);
  });

  it("survives prose wrapping the JSON", () => {
    const r = parseClipScoreResponse(
      'pre {"hook":0.5,"flow":0.5,"engagement":0.5,"trend":0.5,"why":"x"} post',
    );
    expect(r.hook).toBe(0.5);
  });

  it("throws on totally absent JSON", () => {
    expect(() => parseClipScoreResponse("no json here")).toThrow(/no JSON/);
  });
});

describe("combineClipScore", () => {
  it("produces 100 for max scores with default weights", () => {
    const r = combineClipScore(
      { hook: 1, flow: 1, engagement: 1, trend: 1, why: "" },
      30,
    );
    expect(r.score).toBe(100);
    expect(r.durationSec).toBe(30);
  });

  it("produces 0 for min scores", () => {
    const r = combineClipScore(
      { hook: 0, flow: 0, engagement: 0, trend: 0, why: "" },
      30,
    );
    expect(r.score).toBe(0);
  });

  it("respects custom weights", () => {
    // hook=1, others=0; with weights {hook:100, flow:0, engagement:0, trend:0}
    // → 100. Default weights would put it at 30.
    const r = combineClipScore(
      { hook: 1, flow: 0, engagement: 0, trend: 0, why: "" },
      30,
      { hook: 100, flow: 0, engagement: 0, trend: 0 },
    );
    expect(r.score).toBe(100);
  });
});

describe("scoreClipInternal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
  });

  it("throws when no API key is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(scoreClipInternal("hello world", 0, 10)).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it("calls OpenAI chat completions with json_object response format and parses the result", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    let captured: { url: string; body: Record<string, unknown> } | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { body?: string }) => {
        captured = { url, body: JSON.parse(init?.body ?? "{}") };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    hook: 0.8,
                    flow: 0.6,
                    engagement: 0.7,
                    trend: 0.5,
                    why: "tight open, payoff lands",
                  }),
                },
              },
            ],
          }),
          text: async () => "",
        } as unknown as Response;
      }),
    );

    const r = await scoreClipInternal("a strong hook line", 5, 25);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.hook).toBe(0.8);
    expect(r.durationSec).toBe(20);
    expect(captured?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(captured?.body.response_format).toEqual({ type: "json_object" });
    expect(captured?.body.temperature).toBe(0);
  });

  it("propagates HTTP errors with the OpenAI status", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          ok: false,
          status: 429,
          text: async () => "rate limited",
          json: async () => ({}),
        } as unknown as Response;
      }),
    );
    await expect(scoreClipInternal("hi", 0, 10)).rejects.toThrow(/429/);
  });
});
