import { describe, it, expect } from "vitest";
import { parseStack } from "./stack.js";

describe("parseStack", () => {
  it("parses standard V8 frames with function names", () => {
    const stack = `Error: oops
    at UserCard (/repo/src/UserCard.tsx:42:23)
    at renderRoute (/repo/src/router.tsx:88:11)`;
    const frames = parseStack(stack);
    expect(frames).toEqual([
      { fn: "UserCard", file: "/repo/src/UserCard.tsx", line: 42, col: 23, in_app: true },
      { fn: "renderRoute", file: "/repo/src/router.tsx", line: 88, col: 11, in_app: true },
    ]);
  });

  it("parses anonymous frames", () => {
    const stack = `Error: x
    at /repo/src/file.ts:5:10`;
    expect(parseStack(stack)).toEqual([
      { fn: "<anon>", file: "/repo/src/file.ts", line: 5, col: 10, in_app: true },
    ]);
  });

  it("marks node_modules frames as not in_app", () => {
    const stack = `Error: x
    at handler (/repo/node_modules/express/lib/router.js:99:5)
    at userCode (/repo/src/app.ts:10:1)`;
    const frames = parseStack(stack);
    expect(frames[0].in_app).toBe(false);
    expect(frames[1].in_app).toBe(true);
  });

  it("marks node: built-in frames as not in_app", () => {
    const stack = `Error: x
    at fs (node:fs:123:45)
    at userCode (/repo/src/app.ts:10:1)`;
    const frames = parseStack(stack);
    expect(frames[0].in_app).toBe(false);
    expect(frames[1].in_app).toBe(true);
  });

  it("returns empty array for missing stack", () => {
    expect(parseStack(undefined)).toEqual([]);
    expect(parseStack("")).toEqual([]);
  });

  it("skips non-frame lines", () => {
    const stack = `Error: weird
    not a frame line
    at fn (/x.ts:1:1)`;
    const frames = parseStack(stack);
    expect(frames).toHaveLength(1);
    expect(frames[0].fn).toBe("fn");
  });
});
