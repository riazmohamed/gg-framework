import { describe, expect, it } from "vitest";
import { buildCleanupFilter } from "./audio-cleanup.js";

describe("buildCleanupFilter", () => {
  it("builds afftdn for denoise modes", () => {
    expect(buildCleanupFilter("denoise")).toMatch(/^afftdn=/);
    expect(buildCleanupFilter("denoise-strong")).toMatch(/^afftdn=/);
  });

  it("falls back to afftdn when rnnoise mode is requested without a model", () => {
    const f = buildCleanupFilter("rnnoise");
    expect(f).toMatch(/^afftdn=/);
  });

  it("uses arnndn when a model is supplied", () => {
    const f = buildCleanupFilter("rnnoise", { rnnoiseModel: "/path/to/model.rnnn" });
    expect(f).toMatch(/^arnndn=m=/);
    expect(f).toContain("/path/to/model.rnnn");
  });

  it("escapes colons in rnnoise model path", () => {
    const f = buildCleanupFilter("rnnoise", {
      rnnoiseModel: "C:/models/voice.rnnn",
    });
    expect(f).toContain("C\\:/models/voice.rnnn");
  });

  it("dehum at 50Hz hits 50/100/150/200", () => {
    const f = buildCleanupFilter("dehum");
    expect(f).toContain("f=50");
    expect(f).toContain("f=100");
    expect(f).toContain("f=150");
    expect(f).toContain("f=200");
  });

  it("dehum at 60Hz hits 60/120/180/240", () => {
    const f = buildCleanupFilter("dehum", { mainsHz: 60 });
    expect(f).toContain("f=60");
    expect(f).toContain("f=120");
    expect(f).toContain("f=180");
    expect(f).toContain("f=240");
  });

  it("deess uses the deesser filter", () => {
    expect(buildCleanupFilter("deess")).toMatch(/^deesser=/);
  });
});
