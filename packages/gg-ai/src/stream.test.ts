import { describe, it, expect } from "vitest";
import { stream } from "./stream.js";
import { ProviderError } from "./errors.js";

describe("stream() — xiaomi provider", () => {
  it("throws ProviderError when baseUrl is missing", () => {
    expect(() =>
      stream({
        provider: "xiaomi",
        model: "mimo-v2-pro",
        apiKey: "tp-fake-key",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).toThrow(ProviderError);
  });

  it("mentions re-login guidance in the error message", () => {
    expect(() =>
      stream({
        provider: "xiaomi",
        model: "mimo-v2-pro",
        apiKey: "tp-fake-key",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).toThrow(/region|login|baseUrl/i);
  });

  it("does not throw when baseUrl is explicitly provided", () => {
    // Should construct a StreamResult without hitting the network (lazy generator).
    expect(() =>
      stream({
        provider: "xiaomi",
        model: "mimo-v2-pro",
        apiKey: "tp-fake-key",
        baseUrl: "https://token-plan-ams.xiaomimimo.com/v1",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).not.toThrow();
  });
});
