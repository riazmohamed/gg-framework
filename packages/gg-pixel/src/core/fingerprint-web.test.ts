import { describe, it, expect } from "vitest";
import { fingerprintWeb, fnv1a64 } from "./fingerprint-web.js";
import type { StackFrame } from "./types.js";

const frame = (overrides: Partial<StackFrame> = {}): StackFrame => ({
  file: "https://app.com/main.js",
  line: 10,
  col: 5,
  fn: "f",
  in_app: true,
  ...overrides,
});

describe("fingerprintWeb", () => {
  it("is stable for the same input", () => {
    const a = fingerprintWeb("TypeError", [frame()]);
    const b = fingerprintWeb("TypeError", [frame()]);
    expect(a).toBe(b);
  });

  it("produces 16-character lowercase hex", () => {
    const fp = fingerprintWeb("TypeError", [frame()]);
    expect(fp).toMatch(/^[a-f0-9]{16}$/);
  });

  it("differs when error type differs", () => {
    expect(fingerprintWeb("TypeError", [frame()])).not.toBe(
      fingerprintWeb("RangeError", [frame()]),
    );
  });

  it("differs when top frame's line differs", () => {
    expect(fingerprintWeb("TypeError", [frame({ line: 10 })])).not.toBe(
      fingerprintWeb("TypeError", [frame({ line: 11 })]),
    );
  });

  it("ignores query strings and fragments in URLs (they're cache busters)", () => {
    const a = fingerprintWeb("TypeError", [frame({ file: "https://app.com/main.js?v=abc" })]);
    const b = fingerprintWeb("TypeError", [frame({ file: "https://app.com/main.js" })]);
    expect(a).toBe(b);
  });

  it("handles empty stack", () => {
    expect(fingerprintWeb("TypeError", [])).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe("fnv1a64", () => {
  it("returns a deterministic 16-char hex digest", () => {
    expect(fnv1a64("hello")).toMatch(/^[a-f0-9]{16}$/);
    expect(fnv1a64("hello")).toBe(fnv1a64("hello"));
  });

  it("produces different digests for different input", () => {
    expect(fnv1a64("a")).not.toBe(fnv1a64("b"));
  });

  it("handles empty string", () => {
    expect(fnv1a64("")).toMatch(/^[a-f0-9]{16}$/);
  });
});
