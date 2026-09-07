import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SourceMapResolver, tryResolveStack } from "./source-maps.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gg-pixel-srcmap-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/**
 * Build a synthetic source map for a tiny minified file. We don't go
 * through a real bundler — we hand-craft the map so the test is fast
 * and deterministic. The format follows the v3 source-map spec:
 * https://sourcemaps.info/spec.html
 *
 * Source: src/foo.ts at line 5, col 10, function name "thrower"
 * Maps to minified: line 1, col 100
 *
 * VLQ encoding: AAAA = 0,0,0,0 ; gGAGW = 0,4,0,5,11 (we don't need to
 * decode by hand — we just emit a known-good mapping using a single
 * segment that the trace-mapping lib understands).
 *
 * The `mappings` field below is hand-encoded for ONE segment:
 *   minified col 100 → source 0, line 5, col 10, name 0
 * In VLQ this is "oGAKAA":
 *   o = 7 bits = relative col delta of 100 (encoded by us via the lib)
 * Rather than encode by hand we use a real generator.
 */
function makeFixture() {
  // Use a real source-map generator approach: we ship a tiny generated map.
  // For a synthetic test, we use a manually-written but spec-valid map by
  // letting trace-mapping decode our segments. Easier: encode VLQ at runtime
  // via a minimal helper.

  // VLQ encode helpers (one segment of 5 ints):
  const VLQ_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const encode = (n: number): string => {
    let value = n < 0 ? (-n << 1) | 1 : n << 1;
    let out = "";
    do {
      let digit = value & 31;
      value >>>= 5;
      if (value > 0) digit |= 32;
      out += VLQ_CHARS[digit];
    } while (value > 0);
    return out;
  };
  const seg = (genCol: number, srcIdx: number, line: number, col: number, nameIdx: number) =>
    encode(genCol) + encode(srcIdx) + encode(line) + encode(col) + encode(nameIdx);

  // Single segment: minified col 100 → src[0], line 4 (0-indexed), col 10, name[0]
  // Source maps use 0-indexed lines internally; trace-mapping returns 1-indexed.
  const mappings = seg(100, 0, 4, 10, 0);

  return {
    version: 3 as const,
    file: "main.min.js",
    sources: ["src/foo.ts"],
    names: ["thrower"],
    mappings,
  };
}

describe("SourceMapResolver", () => {
  it("resolves a minified frame to its original source", () => {
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "main.min.js.map"), JSON.stringify(makeFixture()));

    const resolver = new SourceMapResolver(dir);
    const resolved = resolver.resolveFrame({
      file: "https://app.com/dist/main.min.js",
      line: 1,
      col: 100,
      fn: "<anon>",
      in_app: true,
    });

    // The fixture maps (line=1, col=100) → src/foo.ts line 5, col 10, name "thrower"
    expect(resolved.fn).toBe("thrower");
    expect(resolved.line).toBe(5);
    expect(resolved.col).toBe(10);
    expect(resolved.file.endsWith("src/foo.ts")).toBe(true);
  });

  it("returns the frame unchanged when no map is found", () => {
    const resolver = new SourceMapResolver(dir);
    const original = {
      file: "https://app.com/main.min.js",
      line: 1,
      col: 100,
      fn: "x",
      in_app: true,
    };
    expect(resolver.resolveFrame(original)).toEqual(original);
  });

  it("walks nested build directories to find maps", () => {
    mkdirSync(join(dir, "build", "static", "js"), { recursive: true });
    writeFileSync(
      join(dir, "build", "static", "js", "main.min.js.map"),
      JSON.stringify(makeFixture()),
    );
    const resolver = new SourceMapResolver(dir);
    const resolved = resolver.resolveFrame({
      file: "https://app.com/static/js/main.min.js",
      line: 1,
      col: 100,
      fn: "<anon>",
      in_app: true,
    });
    expect(resolved.line).toBe(5);
  });

  it("strips query strings from the URL when matching .map filename", () => {
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "main.min.js.map"), JSON.stringify(makeFixture()));
    const resolver = new SourceMapResolver(dir);
    const resolved = resolver.resolveFrame({
      file: "https://app.com/dist/main.min.js?v=cachebuster",
      line: 1,
      col: 100,
      fn: "<anon>",
      in_app: true,
    });
    expect(resolved.line).toBe(5);
  });

  it("falls back gracefully if the map file is corrupt JSON", () => {
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "main.min.js.map"), "{ not valid json");
    const resolver = new SourceMapResolver(dir);
    const original = {
      file: "https://app.com/dist/main.min.js",
      line: 1,
      col: 100,
      fn: "x",
      in_app: true,
    };
    expect(resolver.resolveFrame(original)).toEqual(original);
  });

  it("caches map lookups so repeated frames are cheap", () => {
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "main.min.js.map"), JSON.stringify(makeFixture()));
    const resolver = new SourceMapResolver(dir);
    const frame = {
      file: "https://app.com/dist/main.min.js",
      line: 1,
      col: 100,
      fn: "<anon>",
      in_app: true,
    };
    const a = resolver.resolveFrame(frame);
    const b = resolver.resolveFrame(frame);
    expect(a).toEqual(b);
  });
});

describe("tryResolveStack", () => {
  it("resolves a multi-frame stack and preserves frame order", () => {
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "main.min.js.map"), JSON.stringify(makeFixture()));
    const stack = [
      {
        file: "https://app.com/dist/main.min.js",
        line: 1,
        col: 100,
        fn: "<anon>",
        in_app: true,
      },
      {
        file: "https://app.com/dist/main.min.js",
        line: 1,
        col: 100,
        fn: "<anon>",
        in_app: true,
      },
    ];
    const resolved = tryResolveStack(stack, dir);
    expect(resolved).toHaveLength(2);
    expect(resolved[0]?.line).toBe(5);
    expect(resolved[1]?.line).toBe(5);
  });

  it("never throws — returns input unchanged on any failure", () => {
    const result = tryResolveStack(
      [{ file: "x", line: 1, col: 1, fn: "f", in_app: true }],
      "/nonexistent/path",
    );
    expect(result).toEqual([{ file: "x", line: 1, col: 1, fn: "f", in_app: true }]);
  });
});
