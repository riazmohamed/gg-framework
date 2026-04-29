import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { panelSourceDir } from "./installer.js";

describe("panelSourceDir", () => {
  it("locates the panel/ directory containing a manifest", () => {
    const dir = panelSourceDir();
    expect(existsSync(join(dir, "CSXS", "manifest.xml"))).toBe(true);
    expect(existsSync(join(dir, "index.html"))).toBe(true);
    expect(existsSync(join(dir, "lib", "server.js"))).toBe(true);
    expect(existsSync(join(dir, "jsx", "runtime.jsx"))).toBe(true);
  });
});
