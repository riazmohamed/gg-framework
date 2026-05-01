import type * as NodeOs from "node:os";
import { describe, expect, it, vi } from "vitest";
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

  it("sets PYTHONHOME to the python prefix on Windows when not preset", async () => {
    // Mock node:os.platform() to report Windows. resolveEnv() reads platform()
    // lazily so we re-import after mocking.
    vi.resetModules();
    vi.doMock("node:os", async () => {
      const real = await vi.importActual<typeof NodeOs>("node:os");
      return { ...real, platform: () => "win32" };
    });
    const before = process.env.PYTHONHOME;
    delete process.env.PYTHONHOME;
    try {
      const mod = await import("./bridge.js");
      const env = mod.resolveEnv({ cmd: "python", args: [], prefix: "C:/Python311" });
      expect(env.PYTHONHOME).toBe("C:/Python311");
    } finally {
      if (before === undefined) delete process.env.PYTHONHOME;
      else process.env.PYTHONHOME = before;
      vi.doUnmock("node:os");
      vi.resetModules();
    }
  });

  it("does not set PYTHONHOME on darwin/linux", () => {
    // Real platform() on the test runner is darwin or linux — no Windows path
    // taken, so PYTHONHOME stays undefined unless the user pre-set it.
    const beforeHome = process.env.PYTHONHOME;
    delete process.env.PYTHONHOME;
    try {
      const env = resolveEnv({ cmd: "python3", args: [], prefix: "/usr/local" });
      expect(env.PYTHONHOME).toBeUndefined();
    } finally {
      if (beforeHome !== undefined) process.env.PYTHONHOME = beforeHome;
    }
  });

  it("preserves a pre-set PYTHONHOME on Windows", async () => {
    vi.resetModules();
    vi.doMock("node:os", async () => {
      const real = await vi.importActual<typeof NodeOs>("node:os");
      return { ...real, platform: () => "win32" };
    });
    const before = process.env.PYTHONHOME;
    process.env.PYTHONHOME = "C:/User/CustomHome";
    try {
      const mod = await import("./bridge.js");
      const env = mod.resolveEnv({ cmd: "python", args: [], prefix: "C:/Python311" });
      expect(env.PYTHONHOME).toBe("C:/User/CustomHome");
    } finally {
      if (before === undefined) delete process.env.PYTHONHOME;
      else process.env.PYTHONHOME = before;
      vi.doUnmock("node:os");
      vi.resetModules();
    }
  });
});
