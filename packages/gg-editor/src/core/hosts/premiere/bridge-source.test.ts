import { describe, expect, it } from "vitest";
import { buildJsxScript, PREMIERE_METHODS } from "./bridge-source.js";

describe("buildJsxScript", () => {
  it("produces a non-empty script for every supported method", () => {
    for (const m of PREMIERE_METHODS) {
      const jsx = buildJsxScript(m, {}, "/tmp/out.json");
      expect(jsx.length).toBeGreaterThan(0);
      expect(jsx).toContain("_writeJson");
      expect(jsx).toContain("/tmp/out.json");
    }
  });

  it("throws on unknown method", () => {
    expect(() => buildJsxScript("not_a_method", {}, "/tmp/out.json")).toThrow(
      /unknown premiere method/,
    );
  });

  it("escapes quotes in output path", () => {
    const jsx = buildJsxScript("ping", {}, '/tmp/with "quote".json');
    // Should appear escaped, not raw.
    expect(jsx).not.toContain('"/tmp/with "quote".json"');
    expect(jsx).toContain('with \\"quote\\"');
  });

  it("encodes params as a JSON-parseable string in JSX", () => {
    const jsx = buildJsxScript("add_marker", { frame: 30, note: 'hi "there"' }, "/tmp/o.json");
    // The script should contain a JSON.parse(...) call with our params.
    expect(jsx).toContain("JSON.parse(");
    expect(jsx).toContain("frame");
    // Quotes inside the JSON-string must be doubly escaped.
    expect(jsx).toContain('\\"frame\\":30');
  });

  it("wraps every method body in try/catch that emits ok:false on throw", () => {
    const jsx = buildJsxScript("ping", {}, "/tmp/o.json");
    expect(jsx).toContain("try {");
    expect(jsx).toContain("ok: false");
    expect(jsx).toContain("ok: true");
  });
});
