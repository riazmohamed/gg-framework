import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// We can't `vi.spyOn` on a node:child_process export under ESM (the namespace
// is frozen), so we mock the whole module via vi.doMock and re-import python.js
// after each mock so the new spawnSync is wired in. resetModules() between
// tests also wipes the module-level cache inside python.js for free.

interface FakeSpawnSyncResult {
  pid: number;
  status: number;
  signal: NodeJS.Signals | null;
  output: Array<string | null>;
  stdout: string;
  stderr: string;
}

function ok(stdout: string): FakeSpawnSyncResult {
  return { pid: 0, status: 0, signal: null, output: [], stdout, stderr: "" };
}

function fail(): FakeSpawnSyncResult {
  return { pid: 0, status: 1, signal: null, output: [], stdout: "", stderr: "" };
}

describe("findPython caching", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("node:child_process");
    vi.resetModules();
  });

  it("returns the same PythonCmd on every call and only spawns once", async () => {
    const calls: Array<{ cmd: string; args: readonly string[] }> = [];
    vi.doMock("node:child_process", () => ({
      spawnSync: (cmd: string, args: readonly string[]) => {
        calls.push({ cmd, args });
        if (cmd === "python3") return ok("Python 3.11.4\n");
        return fail();
      },
      spawn: () => {
        throw new Error("spawn should not be called by findPython");
      },
    }));

    const mod = await import("./python.js");
    mod.__resetPythonCacheForTests();

    const first = mod.findPython();
    expect(first?.cmd).toBe("python3");
    // Two probes on first call: --version, then sys.prefix.
    expect(calls.length).toBe(2);

    for (let i = 0; i < 25; i++) {
      const next = mod.findPython();
      expect(next).toBe(first);
    }
    // Cache hit — no further spawns.
    expect(calls.length).toBe(2);
  });

  it("does not cache a negative result", async () => {
    let probeCount = 0;
    vi.doMock("node:child_process", () => ({
      spawnSync: () => {
        probeCount++;
        return fail();
      },
      spawn: () => {
        throw new Error("spawn should not be called");
      },
    }));

    const mod = await import("./python.js");
    mod.__resetPythonCacheForTests();

    expect(mod.findPython()).toBeUndefined();
    const probesAfterFirst = probeCount;
    expect(probesAfterFirst).toBeGreaterThanOrEqual(3); // tries python3, python, py

    // Second call must re-probe — Python may have been installed since.
    expect(mod.findPython()).toBeUndefined();
    expect(probeCount).toBeGreaterThan(probesAfterFirst);
  });

  it("falls back to `python` when `python3` is absent and caches it", async () => {
    const calls: string[] = [];
    vi.doMock("node:child_process", () => ({
      spawnSync: (cmd: string) => {
        calls.push(cmd);
        if (cmd === "python") return ok("Python 3.12.1\n");
        return fail();
      },
      spawn: () => {
        throw new Error("spawn should not be called");
      },
    }));

    const mod = await import("./python.js");
    mod.__resetPythonCacheForTests();

    const first = mod.findPython();
    expect(first?.cmd).toBe("python");

    const before = calls.length;
    const second = mod.findPython();
    expect(second).toBe(first);
    expect(calls.length).toBe(before);
  });

  it("rejects a Python 2 candidate and keeps probing", async () => {
    vi.doMock("node:child_process", () => ({
      spawnSync: (cmd: string) => {
        if (cmd === "python3") return fail();
        if (cmd === "python") return ok("Python 2.7.18\n");
        if (cmd === "py") return ok("Python 3.10.6\n");
        return fail();
      },
      spawn: () => {
        throw new Error("spawn should not be called");
      },
    }));

    const mod = await import("./python.js");
    mod.__resetPythonCacheForTests();

    const py = mod.findPython();
    expect(py?.cmd).toBe("py");
    expect(py?.args).toEqual(["-3"]);
  });

  it("__resetPythonCacheForTests forces a fresh probe", async () => {
    let probes = 0;
    vi.doMock("node:child_process", () => ({
      spawnSync: (cmd: string) => {
        probes++;
        if (cmd === "python3") return ok("Python 3.11.4\n");
        return fail();
      },
      spawn: () => {
        throw new Error("spawn should not be called");
      },
    }));

    const mod = await import("./python.js");
    mod.__resetPythonCacheForTests();

    mod.findPython();
    const afterFirst = probes;
    mod.findPython();
    expect(probes).toBe(afterFirst); // cached

    mod.__resetPythonCacheForTests();
    mod.findPython();
    expect(probes).toBeGreaterThan(afterFirst); // re-probed
  });
});
