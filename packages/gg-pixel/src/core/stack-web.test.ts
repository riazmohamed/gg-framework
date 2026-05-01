import { describe, it, expect } from "vitest";
import { parseBrowserStack } from "./stack-web.js";

describe("parseBrowserStack — Chrome / V8", () => {
  it("parses named-function frames with parentheses", () => {
    const stack = `TypeError: Cannot read 'name' of undefined
    at UserCard (https://app.com/static/js/main.js:42:13)
    at renderRoute (https://app.com/static/js/main.js:88:11)`;
    const frames = parseBrowserStack(stack, "https://app.com");
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({
      fn: "UserCard",
      file: "https://app.com/static/js/main.js",
      line: 42,
      col: 13,
      in_app: true,
    });
  });

  it("parses anonymous frames without function names", () => {
    const stack = `Error: x
    at https://app.com/static/js/main.js:5:10`;
    const frames = parseBrowserStack(stack, "https://app.com");
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      fn: "<anon>",
      file: "https://app.com/static/js/main.js",
      line: 5,
      col: 10,
      in_app: true,
    });
  });
});

describe("parseBrowserStack — Firefox / Gecko", () => {
  it("parses fnName@url:line:col frames", () => {
    const stack = `UserCard@https://app.com/static/js/main.js:42:13
renderRoute@https://app.com/static/js/main.js:88:11`;
    const frames = parseBrowserStack(stack, "https://app.com");
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({
      fn: "UserCard",
      file: "https://app.com/static/js/main.js",
      line: 42,
      col: 13,
      in_app: true,
    });
  });

  it("parses anonymous (empty fn) Gecko frames", () => {
    const stack = `@https://app.com/static/js/main.js:5:10`;
    const frames = parseBrowserStack(stack, "https://app.com");
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      fn: "<anon>",
      file: "https://app.com/static/js/main.js",
      line: 5,
      col: 10,
    });
  });

  it("tolerates missing column (older Firefox)", () => {
    const stack = `foo@https://app.com/x.js:42`;
    const frames = parseBrowserStack(stack, "https://app.com");
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ fn: "foo", line: 42, col: 0 });
  });
});

describe("parseBrowserStack — in_app heuristic", () => {
  it("marks same-origin frames as in_app", () => {
    const stack = `at f (https://app.com/main.js:1:1)`;
    const frames = parseBrowserStack(stack, "https://app.com");
    expect(frames[0]?.in_app).toBe(true);
  });

  it("marks cross-origin frames as not in_app", () => {
    const stack = `at thirdParty (https://cdn.example.com/lib.js:1:1)`;
    const frames = parseBrowserStack(stack, "https://app.com");
    expect(frames[0]?.in_app).toBe(false);
  });

  it("marks chrome-extension frames as not in_app", () => {
    const stack = `at evil (chrome-extension://abcd/inject.js:1:1)`;
    const frames = parseBrowserStack(stack, "https://app.com");
    expect(frames[0]?.in_app).toBe(false);
  });

  it("marks safari-extension and webkit-masked-url frames as not in_app", () => {
    const safari = parseBrowserStack(`at x (safari-extension://abc/x.js:1:1)`, "https://app.com");
    expect(safari[0]?.in_app).toBe(false);

    const masked = parseBrowserStack(
      `at x (webkit-masked-url://hidden/x.js:1:1)`,
      "https://app.com",
    );
    expect(masked[0]?.in_app).toBe(false);
  });
});

describe("parseBrowserStack — robustness", () => {
  it("returns empty array for missing/empty stack", () => {
    expect(parseBrowserStack(undefined)).toEqual([]);
    expect(parseBrowserStack("")).toEqual([]);
  });

  it("skips the leading 'TypeError: x' header line", () => {
    const stack = `TypeError: Cannot read 'foo' of undefined
    at f (https://app.com/x.js:1:1)`;
    const frames = parseBrowserStack(stack, "https://app.com");
    expect(frames).toHaveLength(1);
    expect(frames[0]?.fn).toBe("f");
  });
});
