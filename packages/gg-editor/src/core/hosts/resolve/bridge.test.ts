import { describe, expect, it } from "vitest";
import { findPython, resolveEnv } from "./bridge.js";

describe("findPython", () => {
  it("returns a python3 candidate or undefined cleanly", () => {
    const py = findPython();
    if (py) {
      expect(typeof py.cmd).toBe("string");
      expect(Array.isArray(py.args)).toBe(true);
      expect(["python3", "python", "py"]).toContain(py.cmd);
    }
    // If undefined, that's also a valid environment (CI without Python 3).
  });
});

describe("resolveEnv", () => {
  it("sets PYTHONIOENCODING and PYTHONDONTWRITEBYTECODE", () => {
    const env = resolveEnv();
    expect(env.PYTHONIOENCODING).toBe("utf-8");
    expect(env.PYTHONDONTWRITEBYTECODE).toBe("1");
  });

  it("preserves a pre-set RESOLVE_SCRIPT_API", () => {
    const before = process.env.RESOLVE_SCRIPT_API;
    process.env.RESOLVE_SCRIPT_API = "/custom/path";
    try {
      const env = resolveEnv();
      expect(env.RESOLVE_SCRIPT_API).toBe("/custom/path");
    } finally {
      if (before === undefined) delete process.env.RESOLVE_SCRIPT_API;
      else process.env.RESOLVE_SCRIPT_API = before;
    }
  });

  it("prepends Modules dir to PYTHONPATH when API path is set", () => {
    const before = process.env.RESOLVE_SCRIPT_API;
    process.env.RESOLVE_SCRIPT_API = "/x/y/Scripting";
    try {
      const env = resolveEnv();
      expect(env.PYTHONPATH).toContain("/x/y/Scripting");
      expect(env.PYTHONPATH).toContain("Modules");
    } finally {
      if (before === undefined) delete process.env.RESOLVE_SCRIPT_API;
      else process.env.RESOLVE_SCRIPT_API = before;
    }
  });
});
