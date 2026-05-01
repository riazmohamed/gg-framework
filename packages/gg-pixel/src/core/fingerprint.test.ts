import { describe, it, expect } from "vitest";
import { fingerprint } from "./fingerprint.js";
import type { StackFrame } from "./types.js";

const frame = (overrides: Partial<StackFrame> = {}): StackFrame => ({
  file: "/repo/src/foo.ts",
  line: 10,
  col: 5,
  fn: "foo",
  in_app: true,
  ...overrides,
});

describe("fingerprint", () => {
  it("is stable for the same input", () => {
    const a = fingerprint("TypeError", [frame()]);
    const b = fingerprint("TypeError", [frame()]);
    expect(a).toBe(b);
  });

  it("differs when the error type differs", () => {
    const a = fingerprint("TypeError", [frame()]);
    const b = fingerprint("RangeError", [frame()]);
    expect(a).not.toBe(b);
  });

  it("differs when the top frame differs", () => {
    const a = fingerprint("TypeError", [frame({ line: 10 })]);
    const b = fingerprint("TypeError", [frame({ line: 11 })]);
    expect(a).not.toBe(b);
  });

  it("ignores frames below the top", () => {
    const a = fingerprint("TypeError", [frame(), frame({ line: 99 })]);
    const b = fingerprint("TypeError", [frame(), frame({ line: 1 })]);
    expect(a).toBe(b);
  });

  it("normalizes node_modules paths so different installs collapse", () => {
    const a = fingerprint("TypeError", [
      frame({ file: "/Users/a/proj/node_modules/lib/index.js" }),
    ]);
    const b = fingerprint("TypeError", [
      frame({ file: "/home/b/other/node_modules/lib/index.js" }),
    ]);
    expect(a).toBe(b);
  });

  it("handles empty stack", () => {
    expect(fingerprint("TypeError", [])).toMatch(/^[a-f0-9]{16}$/);
  });
});
