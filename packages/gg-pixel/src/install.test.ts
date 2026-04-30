import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import {
  install,
  detectPackageManager,
  writeEnvKey,
  writeProjectsMapping,
  renderInitFile,
  wireEntryFile,
} from "./install.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gg-pixel-install-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function fakeFetch(
  response: { id: string; key: string; secret?: string },
  status = 201,
): typeof fetch {
  // Default a synthetic secret if the test didn't pass one explicitly — keeps
  // older tests honest without forcing every call site to spell it out.
  const body = { secret: `sk_live_${response.id}_${"a".repeat(64)}`, ...response };
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("install (end-to-end, mocked backend)", () => {
  it("registers project, writes init file, env, and mapping", async () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-app" }));
    const home = mkdtempSync(join(tmpdir(), "gg-pixel-home-"));

    try {
      const result = await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "proj_test", key: "pk_live_abc" }),
      });

      expect(result.projectId).toBe("proj_test");
      expect(result.projectKey).toBe("pk_live_abc");
      expect(result.projectSecret).toMatch(/^sk_live_/);
      expect(result.projectName).toBe("my-app");

      // Mapping persists the secret so subsequent /api/* calls can authenticate.
      const mapAfterCreate = JSON.parse(readFileSync(result.projectsJsonPath, "utf8")) as Record<
        string,
        { secret?: string }
      >;
      expect(mapAfterCreate.proj_test?.secret).toBe(result.projectSecret);

      const initContent = readFileSync(result.initFilePath, "utf8");
      expect(initContent).toContain('import { initPixel } from "@kenkaiiii/gg-pixel"');
      expect(initContent).toContain("process.env.GG_PIXEL_KEY");
      expect(initContent).toContain(
        '"https://gg-pixel-server.buzzbeamaustralia.workers.dev/ingest"',
      );

      expect(readFileSync(result.envFilePath, "utf8")).toContain("GG_PIXEL_KEY=pk_live_abc");

      const map = JSON.parse(readFileSync(result.projectsJsonPath, "utf8")) as Record<
        string,
        { name: string; path: string; secret?: string }
      >;
      expect(map.proj_test?.name).toBe("my-app");
      expect(map.proj_test?.path).toBe(dir);
      expect(map.proj_test?.secret).toBe(result.projectSecret);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("uses --name override when provided", async () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "from-pkg" }));
    const home = mkdtempSync(join(tmpdir(), "gg-pixel-home-"));
    try {
      const result = await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        projectName: "override-name",
        fetchFn: fakeFetch({ id: "proj_x", key: "pk_x" }),
      });
      expect(result.projectName).toBe("override-name");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("falls back to directory name when package.json has no name", async () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({}));
    const home = mkdtempSync(join(tmpdir(), "gg-pixel-home-"));
    try {
      const result = await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "p", key: "k" }),
      });
      expect(result.projectName).toBe(dir.split("/").pop());
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("throws when no project markers exist (package.json or pyproject.toml etc.)", async () => {
    await expect(
      install({
        cwd: dir,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "p", key: "k" }),
      }),
    ).rejects.toThrow(/No project found/);
  });

  it("throws when backend returns non-2xx", async () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }));
    const failingFetch: typeof fetch = (async () =>
      new Response("server error", { status: 500 })) as unknown as typeof fetch;
    await expect(
      install({ cwd: dir, skipPackageInstall: true, fetchFn: failingFetch }),
    ).rejects.toThrow(/POST \/api\/projects failed: 500/);
  });
});

describe("detectPackageManager", () => {
  it("detects pnpm", () => {
    writeFileSync(join(dir, "pnpm-lock.yaml"), "");
    expect(detectPackageManager(dir)).toBe("pnpm");
  });
  it("detects bun", () => {
    writeFileSync(join(dir, "bun.lockb"), "");
    expect(detectPackageManager(dir)).toBe("bun");
  });
  it("detects yarn", () => {
    writeFileSync(join(dir, "yarn.lock"), "");
    expect(detectPackageManager(dir)).toBe("yarn");
  });
  it("defaults to npm", () => {
    expect(detectPackageManager(dir)).toBe("npm");
  });
});

describe("writeEnvKey", () => {
  it("creates a new .env when missing", () => {
    const path = join(dir, ".env");
    writeEnvKey(path, "FOO", "bar");
    expect(readFileSync(path, "utf8")).toBe("FOO=bar\n");
  });
  it("appends to existing .env", () => {
    const path = join(dir, ".env");
    writeFileSync(path, "EXISTING=1\n");
    writeEnvKey(path, "FOO", "bar");
    expect(readFileSync(path, "utf8")).toBe("EXISTING=1\nFOO=bar\n");
  });
  it("replaces existing line for the same key", () => {
    const path = join(dir, ".env");
    writeFileSync(path, "FOO=old\nOTHER=stays\n");
    writeEnvKey(path, "FOO", "new");
    expect(readFileSync(path, "utf8")).toBe("FOO=new\nOTHER=stays\n");
  });
  it("handles file without trailing newline", () => {
    const path = join(dir, ".env");
    writeFileSync(path, "EXISTING=1");
    writeEnvKey(path, "FOO", "bar");
    expect(readFileSync(path, "utf8")).toBe("EXISTING=1\nFOO=bar\n");
  });
});

describe("writeProjectsMapping", () => {
  it("creates ~/.gg/projects.json with the entry", () => {
    const path = join(dir, ".gg", "projects.json");
    writeProjectsMapping(path, "proj_a", "alpha", "/path/to/alpha");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      proj_a: { name: "alpha", path: "/path/to/alpha" },
    });
  });
  it("includes the secret when provided", () => {
    const path = join(dir, ".gg", "projects.json");
    writeProjectsMapping(path, "proj_a", "alpha", "/a", "sk_live_xyz");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      proj_a: { name: "alpha", path: "/a", secret: "sk_live_xyz" },
    });
  });
  it("merges with existing entries", () => {
    const path = join(dir, ".gg", "projects.json");
    writeProjectsMapping(path, "proj_a", "alpha", "/a");
    writeProjectsMapping(path, "proj_b", "beta", "/b");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      proj_a: { name: "alpha", path: "/a" },
      proj_b: { name: "beta", path: "/b" },
    });
  });
  it("recovers from corrupt JSON by overwriting", () => {
    const path = join(dir, ".gg", "projects.json");
    writeProjectsMapping(path, "proj_a", "alpha", "/a");
    writeFileSync(path, "{ not json", "utf8");
    writeProjectsMapping(path, "proj_b", "beta", "/b");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      proj_b: { name: "beta", path: "/b" },
    });
  });
});

describe("install — project-kind dispatch", () => {
  it("detects browser projects via React in dependencies", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "myapp", dependencies: { react: "^19.0.0" } }),
    );
    const home = mkdtempSync(join(tmpdir(), "gg-pixel-home-"));
    try {
      const result = await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "p", key: "k_browser" }),
      });
      expect(result.projectKind).toBe("browser");
      const initContent = readFileSync(result.initFilePath, "utf8");
      expect(initContent).toContain('from "@kenkaiiii/gg-pixel/browser"');
      expect(initContent).toContain('"k_browser"'); // key inlined
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("detects browser projects via vite in devDependencies", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "myapp", devDependencies: { vite: "^5.0.0" } }),
    );
    const home = mkdtempSync(join(tmpdir(), "gg-pixel-home-"));
    try {
      const result = await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "p", key: "k" }),
      });
      expect(result.projectKind).toBe("browser");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("detects browser via index.html", async () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "myapp" }));
    writeFileSync(join(dir, "index.html"), "<html></html>");
    const home = mkdtempSync(join(tmpdir(), "gg-pixel-home-"));
    try {
      const result = await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "p", key: "k" }),
      });
      expect(result.projectKind).toBe("browser");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("defaults to node when no browser markers present", async () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "myapp", bin: "cli.js" }));
    const home = mkdtempSync(join(tmpdir(), "gg-pixel-home-"));
    try {
      const result = await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "p", key: "k" }),
      });
      expect(result.projectKind).toBe("node");
      const initContent = readFileSync(result.initFilePath, "utf8");
      expect(initContent).toContain('from "@kenkaiiii/gg-pixel"'); // Node entry
      expect(initContent).not.toContain("/browser");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("detects Python projects via pyproject.toml", async () => {
    writeFileSync(join(dir, "pyproject.toml"), `[project]\nname = "myapp"\nversion = "0.1.0"\n`);
    writeFileSync(join(dir, "main.py"), `print("hi")\n`);
    const home = mkdtempSync(join(tmpdir(), "gg-pixel-home-"));
    try {
      const result = await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "p", key: "k_py" }),
      });
      expect(result.projectKind).toBe("python");
      expect(result.initFilePath.endsWith("gg_pixel_init.py")).toBe(true);
      const initContent = readFileSync(result.initFilePath, "utf8");
      expect(initContent).toContain("import gg_pixel");
      expect(initContent).toContain('"k_py"');

      // Entry should have been wired
      expect(result.entryWiring.kind).toBe("injected");
      const main = readFileSync(join(dir, "main.py"), "utf8");
      expect(main).toContain("import gg_pixel_init");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("detects Python projects via requirements.txt", async () => {
    writeFileSync(join(dir, "requirements.txt"), "requests==2.31.0\n");
    writeFileSync(join(dir, "app.py"), `print("hi")\n`);
    const home = mkdtempSync(join(tmpdir(), "gg-pixel-home-"));
    try {
      const result = await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "p", key: "k" }),
      });
      expect(result.projectKind).toBe("python");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("throws when neither package.json nor python markers exist", async () => {
    await expect(
      install({
        cwd: dir,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "p", key: "k" }),
      }),
    ).rejects.toThrow(/No project found/);
  });
});

describe("install — hybrid framework wiring", () => {
  function setupHome() {
    const home = mkdtempSync(join(tmpdir(), "gg-pixel-home-"));
    return {
      home,
      cleanup: () => rmSync(home, { recursive: true, force: true }),
    };
  }

  it("detects Next.js and writes both server + client init", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "myapp", dependencies: { next: "^15.0.0", react: "^19.0.0" } }),
    );
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(
      join(dir, "app/layout.tsx"),
      `export default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html><body>{children}</body></html>;\n}\n`,
    );
    const { home, cleanup } = setupHome();
    try {
      const result = await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "p", key: "k_next" }),
      });
      expect(result.projectKind).toBe("nextjs");
      expect(existsSync(join(dir, "instrumentation.ts"))).toBe(true);
      const inst = readFileSync(join(dir, "instrumentation.ts"), "utf8");
      expect(inst).toContain("@kenkaiiii/gg-pixel");
      expect(inst).toContain("NEXT_RUNTIME");
      // next.config patched with serverExternalPackages
      expect(existsSync(join(dir, "next.config.ts"))).toBe(true);
      expect(readFileSync(join(dir, "next.config.ts"), "utf8")).toContain("serverExternalPackages");
      // Client init is now a `.tsx` Client Component (avoids window-on-server).
      expect(existsSync(join(dir, "gg-pixel.client.tsx"))).toBe(true);
      const clientFile = readFileSync(join(dir, "gg-pixel.client.tsx"), "utf8");
      expect(clientFile).toContain('"use client"');
      expect(clientFile).toContain("@kenkaiiii/gg-pixel/browser");
      const layout = readFileSync(join(dir, "app/layout.tsx"), "utf8");
      expect(layout).toContain("GGPixelClient");
      expect(result.secondaryInit?.description).toContain("server instrumentation");
    } finally {
      cleanup();
    }
  });

  it("detects Electron and writes main + renderer init files", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "myapp",
        main: "main.js",
        dependencies: { electron: "^33.0.0", react: "^19.0.0" },
      }),
    );
    writeFileSync(join(dir, "main.js"), `const { app } = require("electron");\napp.whenReady();\n`);
    mkdirSync(join(dir, "src/renderer"), { recursive: true });
    writeFileSync(
      join(dir, "src/renderer/index.tsx"),
      `import { createRoot } from "react-dom/client";\n`,
    );
    const { home, cleanup } = setupHome();
    try {
      const result = await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "p", key: "k_electron" }),
      });
      expect(result.projectKind).toBe("electron");
      // No "type":"module" in fixture → CJS main init
      expect(existsSync(join(dir, "gg-pixel.main.cjs"))).toBe(true);
      expect(existsSync(join(dir, "gg-pixel.renderer.mjs"))).toBe(true);
      // Renderer was wired
      const renderer = readFileSync(join(dir, "src/renderer/index.tsx"), "utf8");
      expect(renderer).toContain("gg-pixel.renderer.mjs");
      // Main was wired (CJS via require)
      const main = readFileSync(join(dir, "main.js"), "utf8");
      expect(main).toContain("gg-pixel.main.cjs");
    } finally {
      cleanup();
    }
  });

  it("detects SvelteKit and creates hooks.server.ts + hooks.client.ts", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "myapp",
        devDependencies: { "@sveltejs/kit": "^2.0.0" },
      }),
    );
    const { home, cleanup } = setupHome();
    try {
      const result = await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "p", key: "k_svelte" }),
      });
      expect(result.projectKind).toBe("sveltekit");
      expect(existsSync(join(dir, "src/hooks.server.ts"))).toBe(true);
      expect(existsSync(join(dir, "src/hooks.client.ts"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("detects Nuxt and creates plugins/gg-pixel.{server,client}.ts", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "myapp", dependencies: { nuxt: "^3.0.0" } }),
    );
    const { home, cleanup } = setupHome();
    try {
      const result = await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "p", key: "k_nuxt" }),
      });
      expect(result.projectKind).toBe("nuxt");
      expect(existsSync(join(dir, "plugins/gg-pixel.server.ts"))).toBe(true);
      expect(existsSync(join(dir, "plugins/gg-pixel.client.ts"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("detects Tauri (via src-tauri/) and warns about Rust gap", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "myapp", dependencies: { react: "^19.0.0" } }),
    );
    mkdirSync(join(dir, "src-tauri"));
    const { home, cleanup } = setupHome();
    try {
      const result = await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "p", key: "k_tauri" }),
      });
      expect(result.projectKind).toBe("tauri");
      expect(result.warnings.some((w) => w.includes("Rust"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("detects React Native and warns rather than installing broken hooks", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "myapp", dependencies: { "react-native": "^0.74.0" } }),
    );
    const { home, cleanup } = setupHome();
    try {
      const result = await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "p", key: "k_rn" }),
      });
      expect(result.projectKind).toBe("react-native");
      expect(result.warnings.some((w) => w.includes("not yet supported"))).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe("install — re-install with a fresh project rewrites stale keys", () => {
  function setupHome() {
    const home = mkdtempSync(join(tmpdir(), "gg-pixel-home-"));
    return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
  }

  it("Next.js: re-install with a new key replaces the stale fallback inside the marker block", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "myapp", dependencies: { next: "^15.0.0", react: "^19.0.0" } }),
    );
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(
      join(dir, "app/layout.tsx"),
      `export default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html><body>{children}</body></html>;\n}\n`,
    );
    const { home, cleanup } = setupHome();
    try {
      // First install — gets old key.
      await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "proj_first", key: "pk_live_OLD_KEY" }),
      });
      const inst1 = readFileSync(join(dir, "instrumentation.ts"), "utf8");
      expect(inst1).toContain("pk_live_OLD_KEY");
      expect(inst1).toContain(">>> gg-pixel auto-generated");

      // Simulate the legacy-mapping scenario: blow away the local mapping so the
      // installer mints a fresh project on the next run.
      rmSync(join(home, ".gg", "projects.json"));
      rmSync(join(dir, ".env"));

      await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "proj_second", key: "pk_live_NEW_KEY" }),
      });
      const inst2 = readFileSync(join(dir, "instrumentation.ts"), "utf8");
      expect(inst2).toContain("pk_live_NEW_KEY");
      expect(inst2).not.toContain("pk_live_OLD_KEY");
      // Exactly one markered block — no accumulation across installs.
      const matches = inst2.match(/>>> gg-pixel auto-generated/g) ?? [];
      expect(matches).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it("SvelteKit: re-install replaces the stale key in hooks.{server,client}.ts", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "myapp", devDependencies: { "@sveltejs/kit": "^2.0.0" } }),
    );
    const { home, cleanup } = setupHome();
    try {
      await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "proj_first", key: "pk_live_SVK_OLD" }),
      });
      const server1 = readFileSync(join(dir, "src/hooks.server.ts"), "utf8");
      const client1 = readFileSync(join(dir, "src/hooks.client.ts"), "utf8");
      expect(server1).toContain("pk_live_SVK_OLD");
      expect(client1).toContain("pk_live_SVK_OLD");

      rmSync(join(home, ".gg", "projects.json"));
      rmSync(join(dir, ".env"));

      await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "proj_second", key: "pk_live_SVK_NEW" }),
      });
      const server2 = readFileSync(join(dir, "src/hooks.server.ts"), "utf8");
      const client2 = readFileSync(join(dir, "src/hooks.client.ts"), "utf8");
      expect(server2).toContain("pk_live_SVK_NEW");
      expect(server2).not.toContain("pk_live_SVK_OLD");
      expect(client2).toContain("pk_live_SVK_NEW");
      expect(client2).not.toContain("pk_live_SVK_OLD");
    } finally {
      cleanup();
    }
  });

  it("strips a pre-marker legacy register() so re-install doesn't end up with two exports", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "myapp", dependencies: { next: "^15.0.0", react: "^19.0.0" } }),
    );
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(
      join(dir, "app/layout.tsx"),
      `export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</box></html>; }`,
    );
    // Hand-write a legacy unmarkered instrumentation.ts (shape produced by
    // gg-pixel < 4.3.86) BEFORE the install runs.
    writeFileSync(
      join(dir, "instrumentation.ts"),
      `// Next.js auto-loads this file on server start. Pixel hooks the
// uncaughtExceptionMonitor + unhandledRejection events for API routes,
// Server Components, and route handlers.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initPixel } = await import("@kenkaiiii/gg-pixel");
    initPixel({
      projectKey: process.env.GG_PIXEL_KEY ?? "pk_live_OLD",
      sink: { kind: "http", ingestUrl: "https://x/ingest" },
    });
  }
}
`,
    );
    const { home, cleanup } = setupHome();
    try {
      await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "proj_x", key: "pk_live_NEW" }),
      });
      const after = readFileSync(join(dir, "instrumentation.ts"), "utf8");
      const exports = after.match(/export\s+async\s+function\s+register\s*\(\s*\)/g) ?? [];
      expect(exports).toHaveLength(1);
      expect(after).toContain("pk_live_NEW");
      expect(after).not.toContain("pk_live_OLD");
      expect(after).toContain(">>> gg-pixel auto-generated");
    } finally {
      cleanup();
    }
  });

  it("findMappingByPath prefers an entry with a secret over a legacy entry at the same path", async () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "myapp" }));
    const { home, cleanup } = setupHome();
    try {
      mkdirSync(join(home, ".gg"), { recursive: true });
      // Two entries for the same project root: legacy (no secret) THEN one with a secret.
      // Iteration order shouldn't matter — the secret entry must win and be reused.
      writeFileSync(
        join(home, ".gg", "projects.json"),
        JSON.stringify({
          proj_legacy: { name: "myapp", path: dir },
          proj_real: {
            name: "myapp",
            path: dir,
            secret: "sk_live_existing_secret_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        }),
      );
      // Also need an env file so the reuse path validates.
      writeFileSync(join(dir, ".env"), "GG_PIXEL_KEY=pk_live_existing\n");

      let createCalls = 0;
      const fetchFn: typeof fetch = (async () => {
        createCalls++;
        return new Response(
          JSON.stringify({ id: "proj_should_not_be_used", key: "pk_x", secret: "sk_x" }),
          { status: 201 },
        );
      }) as unknown as typeof fetch;

      const result = await install({ cwd: dir, homeDir: home, skipPackageInstall: true, fetchFn });
      expect(createCalls).toBe(0); // No new project minted.
      expect(result.reused).toBe(true);
      expect(result.projectId).toBe("proj_real");
      expect(result.projectSecret).toContain("existing_secret");
    } finally {
      cleanup();
    }
  });

  it("preserves user code outside the marker block on re-install", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "myapp", dependencies: { next: "^15.0.0", react: "^19.0.0" } }),
    );
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(
      join(dir, "app/layout.tsx"),
      `export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }`,
    );
    const { home, cleanup } = setupHome();
    try {
      await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "proj_first", key: "pk_live_OLD" }),
      });
      // User adds custom Sentry init *outside* our markered block.
      const before = readFileSync(join(dir, "instrumentation.ts"), "utf8");
      const userBlock = `\n// user code: Sentry init\nexport function userHook() { return 42; }\n`;
      writeFileSync(join(dir, "instrumentation.ts"), before + userBlock, "utf8");

      rmSync(join(home, ".gg", "projects.json"));
      rmSync(join(dir, ".env"));

      await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "proj_second", key: "pk_live_NEW" }),
      });
      const after = readFileSync(join(dir, "instrumentation.ts"), "utf8");
      expect(after).toContain("pk_live_NEW");
      expect(after).not.toContain("pk_live_OLD");
      expect(after).toContain("Sentry init"); // user code untouched
      expect(after).toContain("userHook"); // user code untouched
    } finally {
      cleanup();
    }
  });
});

describe("install — idempotency", () => {
  it("reuses the existing project_id and key when re-running on the same directory", async () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "myapp" }));
    const home = mkdtempSync(join(tmpdir(), "gg-pixel-home-"));
    try {
      let createCalls = 0;
      const countingFetch: typeof fetch = (async () => {
        createCalls++;
        return new Response(
          JSON.stringify({
            id: "proj_first",
            key: "pk_live_first",
            secret: "sk_live_first",
          }),
          { status: 201 },
        );
      }) as unknown as typeof fetch;

      const first = await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: countingFetch,
      });
      expect(first.reused).toBe(false);
      expect(first.projectId).toBe("proj_first");

      // Second run on same dir — should NOT call POST /api/projects again.
      const second = await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: countingFetch,
      });
      expect(second.reused).toBe(true);
      expect(second.projectId).toBe("proj_first");
      expect(second.projectKey).toBe("pk_live_first");
      expect(createCalls).toBe(1);

      // projects.json still has only one entry for this dir
      const map = JSON.parse(readFileSync(second.projectsJsonPath, "utf8")) as Record<
        string,
        { name: string; path: string }
      >;
      expect(Object.values(map).filter((e) => e.path === dir)).toHaveLength(1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("mints a fresh project when the .env was deleted (lost the key)", async () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "myapp" }));
    const home = mkdtempSync(join(tmpdir(), "gg-pixel-home-"));
    try {
      const callKeys = ["pk_live_one", "pk_live_two"];
      const callIds = ["proj_one", "proj_two"];
      let i = 0;
      const fetchFn: typeof fetch = (async () => {
        const id = callIds[i];
        const key = callKeys[i];
        const secret = `sk_live_${id}`;
        i++;
        return new Response(JSON.stringify({ id, key, secret }), { status: 201 });
      }) as unknown as typeof fetch;

      await install({ cwd: dir, homeDir: home, skipPackageInstall: true, fetchFn });
      // Delete .env to simulate lost key.
      rmSync(join(dir, ".env"));

      const second = await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn,
      });
      expect(second.reused).toBe(false);
      expect(second.projectId).toBe("proj_two");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("wireEntryFile", () => {
  it("injects an ESM import at the top of a TypeScript entry", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    const entry = join(dir, "src", "index.ts");
    writeFileSync(entry, 'console.log("hi");\n');
    const initPath = join(dir, "gg-pixel.init.mjs");
    writeFileSync(initPath, "// init\n");

    const result = wireEntryFile(dir, initPath, { main: "src/index.ts" });
    expect(result.kind).toBe("injected");

    const content = readFileSync(entry, "utf8");
    expect(content.split("\n")[0]).toBe('import "../gg-pixel.init.mjs";');
    expect(content).toContain('console.log("hi");');
  });

  it("uses require() for CommonJS entries", () => {
    const entry = join(dir, "main.js");
    writeFileSync(entry, 'console.log("hi");\n');
    const initPath = join(dir, "gg-pixel.init.mjs");
    writeFileSync(initPath, "");

    // pkg.type omitted → CJS by default for .js
    const result = wireEntryFile(dir, initPath, { main: "main.js" });
    expect(result.kind).toBe("injected");
    expect(readFileSync(entry, "utf8").split("\n")[0]).toBe('require("./gg-pixel.init.mjs");');
  });

  it("uses ESM import when package.json type is module", () => {
    const entry = join(dir, "main.js");
    writeFileSync(entry, 'console.log("hi");\n');
    const initPath = join(dir, "gg-pixel.init.mjs");
    writeFileSync(initPath, "");

    const result = wireEntryFile(dir, initPath, { main: "main.js", type: "module" });
    expect(result.kind).toBe("injected");
    expect(readFileSync(entry, "utf8").split("\n")[0]).toBe('import "./gg-pixel.init.mjs";');
  });

  it("preserves shebang when injecting", () => {
    const entry = join(dir, "cli.ts");
    writeFileSync(entry, '#!/usr/bin/env node\nconsole.log("hi");\n');
    const initPath = join(dir, "gg-pixel.init.mjs");
    writeFileSync(initPath, "");

    const result = wireEntryFile(dir, initPath, { bin: "cli.ts" });
    expect(result.kind).toBe("injected");
    const lines = readFileSync(entry, "utf8").split("\n");
    expect(lines[0]).toBe("#!/usr/bin/env node");
    expect(lines[1]).toBe('import "./gg-pixel.init.mjs";');
  });

  it("is idempotent — does not inject twice", () => {
    const entry = join(dir, "index.ts");
    writeFileSync(entry, 'import "./gg-pixel.init.mjs";\nconsole.log("hi");\n');
    const initPath = join(dir, "gg-pixel.init.mjs");
    writeFileSync(initPath, "");

    const result = wireEntryFile(dir, initPath, {});
    expect(result.kind).toBe("already_present");
    // file unchanged
    const lines = readFileSync(entry, "utf8").split("\n");
    expect(lines.filter((l) => l.includes("gg-pixel.init"))).toHaveLength(1);
  });

  it("returns no_entry_found when no candidate exists", () => {
    writeFileSync(join(dir, "package.json"), "{}");
    const initPath = join(dir, "gg-pixel.init.mjs");
    writeFileSync(initPath, "");
    const result = wireEntryFile(dir, initPath, {});
    expect(result.kind).toBe("no_entry_found");
  });

  it("falls back to common conventions when package.json has no main/bin/module", () => {
    mkdirSync(join(dir, "src"));
    const entry = join(dir, "src", "index.ts");
    writeFileSync(entry, 'console.log("hi");\n');
    const initPath = join(dir, "gg-pixel.init.mjs");
    writeFileSync(initPath, "");

    const result = wireEntryFile(dir, initPath, {});
    expect(result.kind).toBe("injected");
    if (result.kind === "injected") expect(result.entryPath).toBe(entry);
  });

  it("resolves bin object — uses first entry", () => {
    const entry = join(dir, "bin/run.js");
    mkdirSync(join(dir, "bin"));
    writeFileSync(entry, 'console.log("hi");\n');
    const initPath = join(dir, "gg-pixel.init.mjs");
    writeFileSync(initPath, "");

    const result = wireEntryFile(dir, initPath, {
      bin: { mything: "bin/run.js" },
      type: "module",
    });
    expect(result.kind).toBe("injected");
    if (result.kind === "injected") expect(result.entryPath).toBe(entry);
  });

  it("falls back from a .js main to a .ts source if only the .ts exists", () => {
    mkdirSync(join(dir, "src"));
    const tsEntry = join(dir, "src", "index.ts");
    writeFileSync(tsEntry, 'console.log("hi");\n');
    const initPath = join(dir, "gg-pixel.init.mjs");
    writeFileSync(initPath, "");

    const result = wireEntryFile(dir, initPath, { main: "src/index.js" });
    expect(result.kind).toBe("injected");
    if (result.kind === "injected") expect(result.entryPath).toBe(tsEntry);
  });
});

describe("renderInitFile", () => {
  it("strips trailing slashes from the ingest URL", () => {
    expect(renderInitFile("https://example.com")).toContain('"https://example.com/ingest"');
  });
});

describe("install — file artifacts on disk", () => {
  it("writes a runnable init file that imports gg-pixel", async () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }));
    const home = mkdtempSync(join(tmpdir(), "gg-pixel-home-"));
    try {
      const result = await install({
        cwd: dir,
        homeDir: home,
        skipPackageInstall: true,
        fetchFn: fakeFetch({ id: "p", key: "k" }),
      });
      expect(existsSync(result.initFilePath)).toBe(true);
      expect(existsSync(result.envFilePath)).toBe(true);
      expect(existsSync(result.projectsJsonPath)).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
